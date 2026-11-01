import { useApp } from '../state/store';
import { PageHeader } from '../components/ui';
import { EmployeeNotesManager } from '../components/EmployeeNotes';
import { ObservationsPage } from './Observations';

export function NotesPage() {
  const { data } = useApp();
  return (
    <>
      <PageHeader
        eyebrow="الموظفون والمتابعة"
        title="الملاحظات والمتابعة"
        description="أضف ملاحظة مرتبطة بموظف، أو سجّل متابعة منظمة مع إجراءها وحالتها."
      />
      <EmployeeNotesManager employees={data.employees} notes={data.employeeNotes} />
      <div className="unified-records-stack">
        <ObservationsPage embedded />
      </div>
    </>
  );
}
