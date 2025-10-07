import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

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
];

const ROLE_DEFINITIONS: Record<string, string[]> = {
  ADMIN: ['CREATE_USER', 'DELETE_USER', 'MANAGE_ROLES'],
  PHARMACIST: ['VIEW_MEDICINE', 'ADD_MEDICINE', 'UPDATE_MEDICINE'],
  CASHIER: ['VIEW_SALES', 'PROCESS_SALES'],
  INVENTORY_MANAGER: ['VIEW_MEDICINE', 'ADD_MEDICINE', 'DELETE_MEDICINE'],
};

export async function POST() {
  try {
    // upsert permissions
    const allPerms = await Promise.all(
      PERMISSIONS.map((perm) =>
        prisma.permission.upsert({
          where: { name: perm.name },
          update: {},
          create: perm,
        }),
      ),
    );

    // upsert roles and connect permissions
    for (const [roleName, permNames] of Object.entries(ROLE_DEFINITIONS)) {
      const role = await prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: {
          name: roleName,
          description: `${roleName.replace('_', ' ')} role`,
        },
      });

      const connect = allPerms
        .filter((p) => permNames.includes(p.name))
        .map((p) => ({ id: p.id }));

      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { set: [], connect } },
      });
    }

    return NextResponse.json({ message: 'ok' });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Bootstrap failed' }, { status: 500 });
  }
}
