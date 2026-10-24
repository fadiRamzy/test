import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { restoreEmployee, setEmployeeStatus, softDeleteEmployee } from '../db/repo';
import type { Employee } from '../db/schema';
import { countNoun, fmtDate, fmtNumber } from '../lib/format';
import { computeEmployeeStats } from '../lib/analytics';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, PageHeader, SearchInput, Select, Table, TableWrap } from '../components/ui';
import { EmployeeStatusBadge, useLookups } from '../components/domain';
import { EmployeeForm } from '../components/forms/EmployeeForm';

type StatusFilter = 'all' | 'active' | 'inactive' | 'archived';

export function EmployeesPage() {
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const route = useRoute();

  const [search, setSearch] = useState(route.query.get('q') ?? '');
  const [branch, setBranch] = useState(route.query.get('branch') ?? 'all');
  const [status, setStatus] = useState<StatusFilter>((route.query.get('status') as StatusFilter) ?? 'all');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Employee | null>(null);

  useEffect(() => {
    if (route.query.get('new') === '1') {
      setEditing(null);
      setFormOpen(true);
    }
  }, [route.query]);

  const statsByEmployee = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeEmployeeStats>>();
    for (const employee of data.employees) map.set(employee.id, computeEmployeeStats(employee, data, settings));
    return map;
  }, [data, settings]);

  const list = useMemo(() => {
    const source = status === 'archived' ? data.archivedEmployees : data.employees;
    return source
      .filter((employee) => (status === 'all' || status === 'archived' ? true : employee.status === status))
      .filter((employee) => (branch === 'all' ? true : employee.branchId === branch))
      .filter((employee) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [employee.fullName, employee.employeeCode, employee.jobTitle, employee.governorate, lookups.branchName(employee.branchId)]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  }, [data, status, branch, search, lookups]);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
    navigate('/employees?new=1', { replace: true });
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    navigate('/employees', { replace: true });
  };

  return (
    <>
      <PageHeader
        title="الموظفون"
        description="ملفات ضباط المخاطر، الرقم الوظيفي، الفرع، الحالة الوظيفية، والسجلات التاريخية."
        actions={
          <>
            <Button icon="reports" onClick={() => navigate('/reports')}>
              تقارير الموظفين
            </Button>
            <Button variant="primary" icon="plus" onClick={openNew}>
              موظف جديد
            </Button>
          </>
        }
      />

      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="بحث بالاسم أو الرقم الوظيفي…" />
        <span className="filter-bar__label">الفرع</span>
        <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="all">كل الفروع</option>
          {lookups.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">الحالة</span>
        <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">الكل</option>
          <option value="active">على رأس العمل</option>
          <option value="inactive">غير نشط</option>
          <option value="archived">المؤرشفون</option>
        </Select>
        <span className="filter-count">
          {countNoun(list.length, 'employee')} — من إجمالي {fmtNumber(data.employees.length)}
        </span>
      </div>

      <Card padded={false}>
        {list.length === 0 ? (
          status === 'archived' ? (
            <EmptyState icon="archive" title="لا يوجد موظفون مؤرشفون" description="الموظفون المحذوفون (حذفًا ناعمًا) يظهرون هنا ويمكن استعادتهم." />
          ) : (
            <EmptyState
              icon="employees"
              title="لا يوجد موظفون مطابقون"
              description="أضف موظفًا جديدًا أو عدّل معايير البحث."
              action={
                <Button variant="primary" icon="plus" onClick={openNew}>
                  إضافة موظف
                </Button>
              }
            />
          )
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>المسمى الوظيفي</th>
                  <th>الفرع</th>
                  <th>المحافظة</th>
                  <th>تاريخ التعيين</th>
                  <th>الحالة</th>
                  <th>دقائق مفتوحة</th>
                  <th>ملاحظات مفتوحة</th>
                  <th>آخر تقييم</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((employee) => {
                  const stats = statsByEmployee.get(employee.id);
                  return (
                    <tr key={employee.id}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => navigate(`/employees/${employee.id}`)}>
                          {employee.fullName}
                        </button>
                        <span className="table__sub">{employee.employeeCode}</span>
                      </td>
                      <td>{employee.jobTitle || '—'}</td>
                      <td>{lookups.branchName(employee.branchId)}</td>
                      <td>{employee.governorate || '—'}</td>
                      <td className="num">{fmtDate(employee.hireDate)}</td>
                      <td>
                        <EmployeeStatusBadge status={employee.status} />
                      </td>
                      <td className="num">{fmtNumber(stats?.minutesPending ?? 0)}</td>
                      <td className="num">{fmtNumber(stats?.observationsOpen ?? 0)}</td>
                      <td className="num">
                        {stats?.latestMonthlySummary?.average != null
                          ? `${stats.latestMonthlySummary.average.toFixed(1)} / ${settings.ratingScale.max}`
                          : '—'}
                      </td>
                      <td className="actions">
                        {status === 'archived' ? (
                          <>
                            <IconButton
                              icon="restore"
                              label="استعادة"
                              onClick={() => void runAction(() => restoreEmployee(employee.id), 'تمت استعادة الموظف.')}
                            />
                          </>
                        ) : (
                          <>
                            <IconButton icon="user" label="الملف" onClick={() => navigate(`/employees/${employee.id}`)} />
                            <IconButton
                              icon="edit"
                              label="تعديل"
                              onClick={() => {
                                setEditing(employee);
                                setFormOpen(true);
                              }}
                            />
                            <IconButton
                              icon={employee.status === 'inactive' ? 'check' : 'lock'}
                              label={employee.status === 'inactive' ? 'تنشيط' : 'إيقاف'}
                              onClick={() =>
                                void runAction(
                                  () => setEmployeeStatus(employee.id, employee.status === 'inactive' ? 'active' : 'inactive'),
                                  'تم تحديث حالة الموظف.',
                                )
                              }
                            />
                            <IconButton icon="trash" label="أرشفة" variant="danger" onClick={() => setArchiveTarget(employee)} />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <EmployeeForm open={formOpen} employee={editing} onClose={closeForm} />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="أرشفة الموظف"
        message={`سيتم أرشفة «${archiveTarget?.fullName ?? ''}» مع الاحتفاظ بكل سجلاته (دقائق، زيارات، ملاحظات، تقييمات). يمكنك استعادته لاحقًا.`}
        confirmLabel="أرشفة"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) void runAction(() => softDeleteEmployee(target.id), 'تمت أرشفة الموظف.');
        }}
      />
    </>
  );
}
