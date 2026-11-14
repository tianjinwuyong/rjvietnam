import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { hrDepartment, hrEmployee } from '../../database/schema';
import { eq, like, desc, SQL } from 'drizzle-orm';

@Injectable()
export class HrService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async listDepartments() {
    const rows = await this.db.select().from(hrDepartment).orderBy(desc(hrDepartment.sortOrder));
    return rows;
  }

  async createDepartment(data: any, userId: string) {
    const deptCode = `DEPT-${Date.now().toString().slice(-6)}`;
    const rows = await this.db
      .insert(hrDepartment)
      .values({
        deptCode,
        deptName: data.deptName,
        deptNameVi: data.deptNameVi || null,
        deptNameEn: data.deptNameEn || null,
        parentId: data.parentId || null,
        sortOrder: data.sortOrder || 0,
        status: 'active',
        remark: data.remark || null,
        createdBy: userId as any,
      })
      .returning();
    return rows[0];
  }

  async updateDepartment(id: string, data: any) {
    const rows = await this.db
      .update(hrDepartment)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(hrDepartment.id, id))
      .returning();
    return rows[0];
  }

  async listEmployees(page: number = 1, pageSize: number = 20, keyword?: string, departmentId?: string) {
    const offset = (page - 1) * pageSize;
    let where: SQL | undefined;
    if (keyword) {
      where = like(hrEmployee.fullName, `%${keyword}%`);
    }
    if (departmentId && !where) {
      where = eq(hrEmployee.departmentId, departmentId);
    }
    const rows = await this.db
      .select()
      .from(hrEmployee)
      .where(where)
      .orderBy(desc(hrEmployee.createdAt))
      .limit(pageSize)
      .offset(offset);

    const totalResult = await this.db.select({ count: () => this.db.fn.count() }).from(hrEmployee).where(where);
    const total = Number(totalResult[0]?.count || 0);

    return { list: rows, total, page, pageSize };
  }

  async getEmployee(id: string) {
    const rows = await this.db.select().from(hrEmployee).where(eq(hrEmployee.id, id)).limit(1);
    return rows[0] || null;
  }

  async createEmployee(data: any, userId: string) {
    const employeeNo = `NV-${Date.now().toString().slice(-6)}`;
    const rows = await this.db
      .insert(hrEmployee)
      .values({
        employeeNo,
        fullName: data.fullName,
        fullNameVi: data.fullNameVi || null,
        gender: data.gender || null,
        birthDate: data.birthDate || null,
        idCard: data.idCard || null,
        phone: data.phone || null,
        email: data.email || null,
        departmentId: data.departmentId || null,
        position: data.position || null,
        employmentType: data.employmentType || 'full_time',
        hireDate: data.hireDate || null,
        status: 'active',
        remark: data.remark || null,
        createdBy: userId as any,
      })
      .returning();
    return rows[0];
  }

  async updateEmployee(id: string, data: any) {
    const rows = await this.db
      .update(hrEmployee)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(hrEmployee.id, id))
      .returning();
    return rows[0];
  }
}
