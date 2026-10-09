import type { FormItemDef, FormSnapshot } from '../../../shared/form';
import { slaToMinutes, WorkHoursMode } from '../../../shared/sla';
import { SEGMENT_LABEL } from '../../../shared/constants';
import { HttpError, Tx, parseJson } from '../core';

export async function loadFormSnapshot(tx: Tx, formId: number | null | undefined): Promise<FormSnapshot | null> {
  if (!formId) return null;
  const form = await tx.form.findUnique({
    where: { id: formId },
    include: { items: { include: { field: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!form) return null;
  return {
    id: form.id,
    code: form.code,
    name: form.name,
    items: form.items.map(
      (it): FormItemDef => ({
        itemId: it.id,
        fieldId: it.fieldId,
        code: it.field.code,
        name: it.field.name,
        infoType: it.field.infoType as any,
        view360Source: it.field.view360Source as any,
        dataType: it.field.dataType as any,
        displayType: it.field.displayType as any,
        options: parseJson(it.field.options, []),
        required: it.field.required,
        showOnTicket: it.field.showOnTicket,
        placeholder: it.field.placeholder,
        sortOrder: it.sortOrder,
        parentItemId: it.parentItemId,
        parentValues: parseJson(it.parentValues, []),
      }),
    ),
  };
}

export const workflowInclude = {
  steps: { include: { results: { orderBy: { sortOrder: 'asc' as const } } }, orderBy: { sortOrder: 'asc' as const } },
};

export function workflowSlaMinutes(wf: { workHoursMode: string; steps: { slaDays: number; slaHours: number; slaMinutes: number }[] }) {
  return wf.steps.reduce((s, x) => s + slaToMinutes(x.slaDays, x.slaHours, x.slaMinutes, wf.workHoursMode as WorkHoursMode), 0);
}

export interface TicketConfigSnapshot {
  service: { id: number; code: string; workHoursMode: WorkHoursMode; segmentMode: string };
  workflow: { id: number; code: string; name: string; slaMinutes: number; segment: string };
  form: FormSnapshot | null;
}

/** Xác định dịch vụ + quy trình áp dụng cho cặp Sản phẩm/Nghiệp vụ và phân khúc khách hàng. */
export async function resolveServiceConfig(tx: Tx, productId: number, operationId: number, segment: string | null | undefined) {
  const service = await tx.service.findUnique({
    where: { productId_operationId: { productId, operationId } },
    include: { workflows: true },
  });
  if (!service || !service.active)
    throw new HttpError(400, 'Chưa có dịch vụ đang sử dụng cho Sản phẩm + Nghiệp vụ đã chọn', {
      operationId: 'Chưa khai báo dịch vụ đang sử dụng cho Sản phẩm + Nghiệp vụ này',
    });
  let mapping;
  if (service.segmentMode === 'ALL') {
    mapping = service.workflows.find((w) => w.segment === 'ALL');
  } else {
    if (!segment)
      throw new HttpError(400, 'Dịch vụ áp dụng quy trình theo phân khúc, vui lòng chọn khách hàng để xác định phân khúc', {
        customerId: 'Cần chọn khách hàng để xác định phân khúc áp dụng quy trình',
      });
    mapping = service.workflows.find((w) => w.segment === segment);
  }
  if (!mapping)
    throw new HttpError(400, `Dịch vụ ${service.code} chưa cấu hình quy trình cho phân khúc ${SEGMENT_LABEL[segment || 'ALL']}`);
  const workflow = await tx.workflow.findUnique({ where: { id: mapping.workflowId }, include: workflowInclude });
  if (!workflow || !workflow.steps.length) throw new HttpError(400, 'Quy trình áp dụng không hợp lệ (không có công việc)');
  const form = await loadFormSnapshot(tx, service.formId);
  const slaMinutes = workflowSlaMinutes(workflow);
  const snapshot: TicketConfigSnapshot = {
    service: {
      id: service.id,
      code: service.code,
      workHoursMode: service.workHoursMode as WorkHoursMode,
      segmentMode: service.segmentMode,
    },
    workflow: { id: workflow.id, code: workflow.code, name: workflow.name, slaMinutes, segment: mapping.segment },
    form,
  };
  return { service, workflow, form, slaMinutes, snapshot };
}
