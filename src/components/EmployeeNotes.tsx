import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, IconButton, Select, Textarea } from './ui';
import { deleteEmployeeNote, saveEmployeeNote } from '../db/repo';
import type { Employee, EmployeeNote } from '../db/schema';
import { useApp } from '../state/store';

export function EmployeeNotesManager({
  employees,
  notes,
  employeeId,
}: {
  employees: Employee[];
  notes: EmployeeNote[];
  /** Set in a profile; omitted in the general employees section. */
  employeeId?: string;
}) {
  const { runAction } = useApp();
  const [selectedEmployee, setSelectedEmployee] = useState(employeeId ?? employees[0]?.id ?? '');
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const profileMode = Boolean(employeeId);

  useEffect(() => {
    setSelectedEmployee(employeeId ?? (employees.some((row) => row.id === selectedEmployee) ? selectedEmployee : employees[0]?.id ?? ''));
  }, [employeeId, employees, selectedEmployee]);

  const rows = useMemo(
    () => notes.filter((row) => !employeeId || row.employeeId === employeeId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [notes, employeeId],
  );
  const employeeById = useMemo(() => new Map(employees.map((row) => [row.id, row])), [employees]);

  const reset = () => {
    setText('');
    setEditingId(null);
  };
  const save = async () => {
    if (!selectedEmployee || !text.trim() || saving) return;
    setSaving(true);
    try {
      await runAction(
        () => saveEmployeeNote({ id: editingId ?? undefined, employeeId: selectedEmployee, note: text }),
        editingId ? 'تم تعديل الملاحظة.' : 'تم حفظ الملاحظة.',
      );
      reset();
    } catch {
      // runAction reports a localized error toast.
    } finally {
      setSaving(false);
    }
  };
  const edit = (row: EmployeeNote) => {
    setSelectedEmployee(row.employeeId);
    setText(row.note);
    setEditingId(row.id);
  };
  const remove = async (id: string) => {
    try {
      await runAction(() => deleteEmployeeNote(id), 'تم حذف الملاحظة.');
      if (editingId === id) reset();
    } catch {
      // runAction reports a localized error toast.
    }
  };

  return (
    <Card title="ملاحظات على الموظف" subtitle="كل ملاحظة تُحفظ كسجل مستقل وتبقى مرتبطة بالموظف المحدد.">
      <div className="formgrid employee-note-form">
        <Field label="الموظف" htmlFor={employeeId ? 'profile-note-employee' : 'employee-note-employee'}>
          <Select
            id={employeeId ? 'profile-note-employee' : 'employee-note-employee'}
            value={employeeId ?? selectedEmployee}
            disabled={profileMode}
            onChange={(event) => setSelectedEmployee(event.target.value)}
          >
            <option value="">اختر الموظف</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </Select>
        </Field>
        <Field label="الملاحظة" htmlFor={employeeId ? 'profile-note-text' : 'employee-note-text'} className="span2">
          <Textarea
            id={employeeId ? 'profile-note-text' : 'employee-note-text'}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="اكتب ملاحظة مستقلة…"
          />
        </Field>
        <div className="span2 formrow">
          <Button variant="primary" icon="save" disabled={saving || !selectedEmployee || !text.trim()} onClick={save}>
            {saving ? 'جارٍ الحفظ…' : editingId ? 'حفظ التعديل' : profileMode ? 'حفظ' : 'حفظ الملاحظة'}
          </Button>
          {editingId ? <Button onClick={reset}>إلغاء التعديل</Button> : null}
        </div>
      </div>

      {rows.length ? (
        <div className="employee-note-list" aria-label="الملاحظات المحفوظة">
          {rows.map((row) => (
            <article className="employee-note-item" key={row.id}>
              <div className="employee-note-content">
                {!employeeId ? <strong className="employee-note-owner">{employeeById.get(row.employeeId)?.name ?? 'موظف غير موجود'}</strong> : null}
                <p dir="auto">{row.note}</p>
              </div>
              <div className="employee-note-actions">
                <IconButton icon="edit" label="تعديل الملاحظة" onClick={() => edit(row)} />
                <IconButton icon="trash" label="حذف الملاحظة" tone="danger" onClick={() => remove(row.id)} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="small muted employee-note-empty">لا توجد ملاحظات محفوظة لهذا الموظف.</p>
      )}
    </Card>
  );
}
