import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { salesCustomer } from '../../database/schema';
import { eq, like, desc, SQL } from 'drizzle-orm';

@Injectable()
export class SalesService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async listCustomers(page: number = 1, pageSize: number = 20, keyword?: string) {
    const offset = (page - 1) * pageSize;
    let where: SQL | undefined;
    if (keyword) {
      where = like(salesCustomer.customerName, `%${keyword}%`);
    }
    const rows = await this.db
      .select()
      .from(salesCustomer)
      .where(where)
      .orderBy(desc(salesCustomer.createdAt))
      .limit(pageSize)
      .offset(offset);

    const totalResult = await this.db.select({ count: () => this.db.fn.count() }).from(salesCustomer).where(where);
    const total = Number(totalResult[0]?.count || 0);

    return { list: rows, total, page, pageSize };
  }

  async getCustomer(id: string) {
    const rows = await this.db.select().from(salesCustomer).where(eq(salesCustomer.id, id)).limit(1);
    return rows[0] || null;
  }

  async createCustomer(data: any, userId: string) {
    const customerCode = `CUST-${Date.now().toString().slice(-6)}`;
    const rows = await this.db
      .insert(salesCustomer)
      .values({
        customerCode,
        customerName: data.customerName,
        customerNameVi: data.customerNameVi || null,
        customerNameEn: data.customerNameEn || null,
        contactPerson: data.contactPerson || null,
        contactPhone: data.contactPhone || null,
        contactEmail: data.contactEmail || null,
        address: data.address || null,
        taxCode: data.taxCode || null,
        paymentTerm: data.paymentTerm || 'NET30',
        currency: data.currency || 'VND',
        status: 'active',
        remark: data.remark || null,
        createdBy: userId as any,
      })
      .returning();
    return rows[0];
  }

  async updateCustomer(id: string, data: any) {
    const rows = await this.db
      .update(salesCustomer)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(salesCustomer.id, id))
      .returning();
    return rows[0];
  }

  async deleteCustomer(id: string) {
    await this.db.update(salesCustomer).set({ status: 'inactive' }).where(eq(salesCustomer.id, id));
    return { success: true };
  }
}
