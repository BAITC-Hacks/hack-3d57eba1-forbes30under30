import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, POST } from "../app/api/scenarios/route";
import { referenceValues, type Decision } from "../lib/engine/data";
import { score } from "../lib/engine/score";
import { savedScenarioSchema } from "../lib/scenarios/schema";

const example: Decision[] = referenceValues.exampleSet.decisions.map(([measureId, districtId]) => ({
  measureId,
  ...(districtId === null ? {} : { districtId }),
}));
const optimal: Decision[] = referenceValues.bestKnownSet.decisions.map(([measureId, districtId]) => ({
  measureId,
  ...(districtId === null ? {} : { districtId }),
}));

function request(body: unknown): Request {
  return new Request("http://localhost/api/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  const previousDirectory = process.cwd();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "akim-scenarios-"));
  const filePath = path.join(temporaryDirectory, "data", "scenarios.json");
  let checks = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    await run();
    checks += 1;
    console.log(`✓ ${name}`);
  };

  try {
    // Route handlers use process.cwd(); all writes stay outside the repository.
    process.chdir(temporaryDirectory);

    await check("GET без файла возвращает пустой список и не создаёт файл", async () => {
      const response = await GET();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await response.json(), []);
      await assert.rejects(access(filePath), { code: "ENOENT" });
    });

    await check("Первое сохранение создаёт файл и не доверяет числам клиента", async () => {
      const startedAt = Date.now();
      const response = await POST(request({
        name: "  Команда ТЗ  ", decisions: example,
        score: 99999, cost: -100, createdAt: "2000-01-01T00:00:00.000Z",
      }));
      assert.equal(response.status, 201);
      const record = savedScenarioSchema.parse(await response.json());
      assert.equal(record.name, "Команда ТЗ");
      assert.equal(record.score, score(example).score);
      assert.equal(record.cost, 95);
      assert.deepEqual(record.decisions, example);
      assert.ok(Date.parse(record.createdAt) >= startedAt);
      assert.ok(Date.parse(record.createdAt) <= Date.now());
      assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), [record]);
    });

    await check("Некорректный JSON отклоняется без изменения файла", async () => {
      const before = await readFile(filePath, "utf8");
      const response = await POST(new Request("http://localhost/api/scenarios", {
        method: "POST", body: "{broken",
      }));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /JSON/);
      assert.equal(await readFile(filePath, "utf8"), before);
    });

    await check("Неверные имена и решения отклоняются по правилам движка", async () => {
      const before = await readFile(filePath, "utf8");
      const invalidBodies: unknown[] = [
        null, [], { name: "   ", decisions: example },
        { name: "А".repeat(101), decisions: example },
        { name: 123, decisions: example },
        { name: "Нет решений" },
        { name: "Неполный набор", decisions: example.slice(1) },
        { name: "Дубли", decisions: [example[0], example[0], ...example.slice(2)] },
        { name: "Неизвестный район", decisions: example.map((item, index) => (
          index === 0 ? { ...item, districtId: "unknown" } : item
        )) },
      ];
      for (const body of invalidBodies) {
        const response = await POST(request(body));
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(typeof (await response.json()).error, "string");
      }
      assert.equal(await readFile(filePath, "utf8"), before);
    });

    await check("Параллельные POST не теряют сохранённые сценарии", async () => {
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => (
        POST(request({ name: `Команда ${index}`, decisions: example }))
      )));
      assert.ok(responses.every((response) => response.status === 201));
      const rows = savedScenarioSchema.array().parse(await (await GET()).json());
      assert.equal(rows.length, 21);
      assert.equal(new Set(rows.map((row) => row.name)).size, 21);
      assert.ok((await readdir(path.dirname(filePath))).every((name) => !name.endsWith(".tmp")));
    });

    await check("Список отсортирован по Score и детерминирован при равенстве", async () => {
      assert.equal((await POST(request({ name: "Оптимальный", decisions: optimal }))).status, 201);
      const rows = savedScenarioSchema.array().parse(await (await GET()).json());
      assert.equal(rows[0].name, "Оптимальный");
      assert.equal(rows[0].score, score(optimal).score);
      for (let index = 1; index < rows.length; index += 1) {
        assert.ok(rows[index - 1].score >= rows[index].score);
        if (rows[index - 1].score === rows[index].score) {
          assert.ok(rows[index - 1].createdAt <= rows[index].createdAt);
        }
      }
      assert.deepEqual(await (await GET()).json(), rows);
    });

    await check("GET перечитывает сохранённый файл без устаревшего кэша", async () => {
      const rows = savedScenarioSchema.array().parse(JSON.parse(await readFile(filePath, "utf8")));
      rows.push({ ...rows[0], name: "Из файла" });
      await writeFile(filePath, JSON.stringify(rows), "utf8");
      const response = await GET();
      const reloaded = savedScenarioSchema.array().parse(await response.json());
      assert.ok(reloaded.some((record) => record.name === "Из файла"));
      assert.equal(reloaded.length, 23);
    });

    const validFile = await readFile(filePath, "utf8");
    await check("Повреждённый JSON даёт понятную ошибку и не перезаписывается", async () => {
      const corrupted = "{ повреждённый файл";
      await writeFile(filePath, corrupted, "utf8");
      const getResponse = await GET();
      const postResponse = await POST(request({ name: "Новый", decisions: example }));
      assert.equal(getResponse.status, 500);
      assert.equal(postResponse.status, 500);
      assert.match((await getResponse.json()).error, /Не удалось загрузить/);
      assert.match((await postResponse.json()).error, /Не удалось сохранить/);
      assert.equal(await readFile(filePath, "utf8"), corrupted);
    });

    await check("Валидный JSON с неверной структурой также сохраняется без потерь", async () => {
      const malformed = JSON.stringify([{ name: "Неполная запись" }]);
      await writeFile(filePath, malformed, "utf8");
      assert.equal((await GET()).status, 500);
      assert.equal((await POST(request({ name: "Новый", decisions: example }))).status, 500);
      assert.equal(await readFile(filePath, "utf8"), malformed);
    });

    await check("После ошибки сохранения очередь продолжает работать", async () => {
      await writeFile(filePath, validFile, "utf8");
      const response = await POST(request({ name: "После восстановления", decisions: example }));
      assert.equal(response.status, 201);
      assert.equal((await (await GET()).json()).length, 24);
    });

    await check("Ошибка файловой системы не выдаёт стек пользователю", async () => {
      await rm(filePath);
      await mkdir(filePath);
      for (const response of [await GET(), await POST(request({ name: "IO", decisions: example }))]) {
        assert.equal(response.status, 500);
        const body = await response.json();
        assert.deepEqual(Object.keys(body), ["error"]);
        assert.doesNotMatch(body.error, /EISDIR|\bat .*:\d+|Error:/);
      }
    });

    console.log(`Проверки сохранения сценариев: ${checks} успешно. Файлы репозитория не изменены.`);
  } finally {
    process.chdir(previousDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`Проверка сценариев не прошла: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  process.exitCode = 1;
});
