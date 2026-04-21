var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server/router/hello.ts
var hello_exports = {};
__export(hello_exports, {
  default: () => hello
});
module.exports = __toCommonJS(hello_exports);

// server/schema/index.ts
var import_pg_core = require("drizzle-orm/pg-core");
var appSchema = (0, import_pg_core.pgSchema)("test3");
var usersTable = appSchema.table("users", {
  id: (0, import_pg_core.integer)().primaryKey().generatedAlwaysAsIdentity(),
  email: (0, import_pg_core.varchar)({ length: 255 }).notNull().unique(),
  displayName: (0, import_pg_core.varchar)({ length: 255 }).notNull(),
  phone: (0, import_pg_core.varchar)({ length: 50 }),
  remark: (0, import_pg_core.varchar)({ length: 500 }),
  active: (0, import_pg_core.boolean)().notNull().default(true),
  createdAt: (0, import_pg_core.timestamp)().notNull().defaultNow(),
  updatedAt: (0, import_pg_core.timestamp)().notNull().defaultNow()
});

// server/router/hello.ts
async function hello(c) {
  setTimeout(() => {console.log(2333)}, 2000)
  const db = c.get("db");
  if (!db) {
    return { message: "Database not configured" };
  }
  const email = `test_${Math.random().toString(36).slice(2, 10)}@test.com`;
  const displayName = `Test User ${Math.random().toString(36).slice(2, 10)}`;
  const phone = `138${Math.random().toString().slice(2, 10)}`;
  const remark = `Test Remark ${Math.random().toString(36).slice(2, 10)}`;
  const active = true;
  const [row] = await db.insert(usersTable).values({
    email,
    displayName,
    phone,
    remark,
    active
  }).returning();
  return row;
}
