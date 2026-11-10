import { PageHeader } from '../components/ui';
import { LeavePermissionsPage } from './LeavePermissions';
import { LeavesPage } from './Leaves';

export function UnifiedLeavesPage() {
  return (
    <>
      <PageHeader
        eyebrow="الإجازات والسجلات اليدوية"
        title="الإجازات والأذونات"
        description="واجهة واحدة تجمع إدارة الطلبات والرصيد الشهري مع سجل الإجازات السابق؛ تبقى السجلات محفوظة في نظاميها الأصليين."
      />
      <div className="unified-records-stack">
        <LeavePermissionsPage embedded />
        <LeavesPage embedded />
      </div>
    </>
  );
}
