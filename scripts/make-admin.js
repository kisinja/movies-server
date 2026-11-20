require("dotenv").config();

const prisma = require("../lib/prisma");
const { writeAudit } = require("../utils/audit");

async function main() {
  const email = process.argv[2];
  if (!email || process.argv.length !== 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Usage: node scripts/make-admin.js someone@example.com");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.$transaction(async (db) => {
    const existing = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, role: true },
    });
    if (!existing) {
      throw new Error(`No account exists for ${normalizedEmail}. Register that user first.`);
    }
    if (existing.role !== "ADMIN") {
      await db.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN" },
        select: { id: true },
      });
      await writeAudit(db, {
        adminId: existing.id,
        action: "user.role_changed",
        targetType: "user",
        targetId: existing.id,
        details: { from: existing.role, to: "ADMIN", bootstrap: true },
      });
    }
    return existing;
  });
  console.log(`${normalizedEmail} is an administrator.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
