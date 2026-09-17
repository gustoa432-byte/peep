import Database from "better-sqlite3";
import { join } from "node:path";

const p = join(process.cwd(), "data/local.db");
const db = new Database(p);
console.log(
  "tables",
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
);
try {
  db.prepare("insert into peep_worlds (id, seed, creator_id) values (?, ?, ?)").run(
    "tst001",
    1,
    "p-test01",
  );
  console.log("insert ok");
  db.prepare("delete from peep_worlds where id = ?").run("tst001");
} catch (e) {
  console.error("insert failed", e);
}
db.close();
