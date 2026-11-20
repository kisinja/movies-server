async function writeAudit(
  db,
  { adminId, action, targetType, targetId, details },
) {
  return db.auditLog.create({
    data: {
      adminId,
      action,
      targetType,
      targetId: String(targetId),
      ...(details === undefined ? {} : { details }),
    },
  });
}

module.exports = { writeAudit };
