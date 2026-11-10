import type { Employee, LeavePermissionRecord } from '../db/schema';

export interface LeavePermissionSummary {
  employee: Employee;
  regularLeaves: number;
  casualLeaves: number;
  deductedLeaves: number;
  totalLeaves: number;
  departurePermissions: number;
  attendancePermissions: number;
  totalPermissions: number;
  permissionHours: number;
  remainingEntries: number;
  remainingHours: number;
}

export function summarizeLeavePermissions(
  employees: Employee[],
  records: LeavePermissionRecord[],
  options: { employeeId: string; year: string; month: string },
): LeavePermissionSummary[] {
  const filtered = records.filter((record) => {
    if (options.employeeId !== 'all' && record.employeeId !== options.employeeId) return false;
    if (!record.date) return false;
    if (options.year !== 'all' && !record.date.startsWith(options.year)) return false;
    if (options.month !== 'all' && record.date.slice(5, 7) !== options.month.padStart(2, '0')) return false;
    return true;
  });
  return employees
    .filter((employee) => options.employeeId === 'all' || employee.id === options.employeeId)
    .map((employee) => {
      const own = filtered.filter((record) => record.employeeId === employee.id);
      const regularLeaves = own.filter((record) => record.requestType === 'leave' && record.category === 'إجازة اعتيادي').length;
      const casualLeaves = own.filter((record) => record.requestType === 'leave' && record.category === 'إجازة عارضة').length;
      const deductedLeaves = own.filter((record) => record.requestType === 'leave' && record.category === 'إجازة بخصم').length;
      const departurePermissions = own.filter((record) => record.requestType === 'permission' && record.category === 'إذن انصرف').length;
      const attendancePermissions = own.filter((record) => record.requestType === 'permission' && record.category === 'إذن حضور').length;
      const totalPermissions = departurePermissions + attendancePermissions;
      const permissionHours = own.reduce(
        (sum, record) => sum + (record.requestType === 'permission' ? record.durationHours ?? 0 : 0),
        0,
      );
      return {
        employee,
        regularLeaves,
        casualLeaves,
        deductedLeaves,
        totalLeaves: regularLeaves + casualLeaves + deductedLeaves,
        departurePermissions,
        attendancePermissions,
        totalPermissions,
        permissionHours,
        remainingEntries: Math.max(0, 4 - totalPermissions),
        remainingHours: Math.max(0, 4 - permissionHours),
      };
    });
}
