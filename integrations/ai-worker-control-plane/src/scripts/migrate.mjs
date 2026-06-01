import { migrate, openDatabase } from "../lib/db.mjs";

const db = openDatabase();
migrate(db);
db.close();

console.log("Database migrated.");

