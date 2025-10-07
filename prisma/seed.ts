// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const PERMISSIONS = [
  { name: 'CREATE_USER', description: 'Create new users' },
  { name: 'DELETE_USER', description: 'Delete users' },
  { name: 'MANAGE_ROLES', description: 'Manage roles and permissions' },
  { name: 'VIEW_MEDICINE', description: 'View medicine inventory' },
  { name: 'ADD_MEDICINE', description: 'Add new medicine to inventory' },
  { name: 'UPDATE_MEDICINE', description: 'Update medicine details' },
  { name: 'DELETE_MEDICINE', description: 'Delete medicine from inventory' },
  { name: 'VIEW_SALES', description: 'View sales records' },
  { name: 'PROCESS_SALES', description: 'Process customer transactions' },
  { name: 'VIEW_NOTIFICATIONS',   description: 'See alerts/notifications' },
  { name: 'MANAGE_NOTIFICATIONS', description: 'Create/delete/mark notifications' },
];


const ROLE_DEFS = {
  ADMIN: [
    'CREATE_USER', 'DELETE_USER', 'MANAGE_ROLES',
    'VIEW_NOTIFICATIONS', 'MANAGE_NOTIFICATIONS',
  ],
  PHARMACIST: [
    'VIEW_MEDICINE', 'ADD_MEDICINE', 'UPDATE_MEDICINE',
    'VIEW_NOTIFICATIONS',
  ],
  CASHIER: [
    'VIEW_SALES', 'PROCESS_SALES',
    'VIEW_NOTIFICATIONS',
  ],
  INVENTORY_MANAGER: [
    'VIEW_MEDICINE', 'ADD_MEDICINE', 'DELETE_MEDICINE',
    'VIEW_NOTIFICATIONS',
  ],
};

async function main() {
  // admin + roles/permissions (kept)
  const admin = await prisma.admin.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash('adminpassword', 12),
    },
  });

  // permissions
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  // roles + link perms + give ADMIN to admin
  for (const [roleName, permNames] of Object.entries(ROLE_DEFS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role` },
    });

    await prisma.role.update({
      where: { id: role.id },
      data: {
        permissions: {
          connect: permNames.map((p) => ({ name: p })),
        },
      },
    });

    if (roleName === 'ADMIN') {
      await prisma.adminRole.upsert({
        where: { adminId_roleId: { adminId: admin.id, roleId: role.id } },
        update: {},
        create: { adminId: admin.id, roleId: role.id },
      });
    }
  }

  // basic user (owns inventory/pharmacy)
  const owner = await prisma.user.upsert({
    where: { email: 'owner@example.com' },
    update: {},
    create: {
      email: 'owner@example.com',
      passwordHash: await bcrypt.hash('password123', 12),
      createdById: admin.id,
    },
  });

  // sample pharmacy (optional)
  await prisma.pharmacy.upsert({
    where: { id: 1 },
    update: {},
    create: {
      userId: owner.id,
      name: 'Main Street Pharmacy',
      address: '123 Main St',
      lat: '27.717000',
      lng: '85.324000',
      sharePublic: false,
    },
  });

  // sample med + batch
  const med = await prisma.medicine.create({
    data: {
      name: 'Paracetamol 500mg',
      strength: '500mg',
      packSize: '10 tablets',
      mrp: '35.00',
      manufacturer: 'ACME Pharma',
    },
  });

  await prisma.inventoryBatch.create({
    data: {
      userId: owner.id,
      medicineId: med.id,
      batchNo: 'BATCH-2025-01',
      manufactureDate: new Date('2025-01-10'),
      expiryDate: new Date('2027-01-10'),
      qtyAvailable: 20,
      costPrice: '20.00',
      mrp: '35.00',
      status: 'ACTIVE',
    },
  });

  console.log('✅ Seeded RBAC + inventory');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());
