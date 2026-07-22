import { z } from "zod";

export const ProjectStatusSchema = z.enum([
  "PREPARING",
  "PRE_REGISTRATION",
  "IN_PROGRESS",
  "CLOSED",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectIdSchema = z.string().trim().min(1);
const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "유효한 날짜를 입력해 주세요.");

function datesInOrder(value: {
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
}) {
  return !value.startDate || !value.endDate || value.endDate >= value.startDate;
}

export const CreateProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    startDate: CalendarDateSchema.optional(),
    endDate: CalendarDateSchema.optional(),
  })
  .refine(datesInOrder, {
    path: ["endDate"],
    message: "종료일은 시작일보다 빠를 수 없습니다.",
  });

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    startDate: CalendarDateSchema.nullable().optional(),
    endDate: CalendarDateSchema.nullable().optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.startDate !== undefined ||
      value.endDate !== undefined,
    "변경할 필드가 필요합니다.",
  )
  .refine(datesInOrder, {
    path: ["endDate"],
    message: "종료일은 시작일보다 빠를 수 없습니다.",
  });

export interface Project {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closeReason: "MANUAL" | "SCHEDULED" | null;
}

export interface ProjectSummary {
  projectId: string;
  expectedTotal: number;
  finalTotal: number;
  deltaTotal: number;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    expected: number;
    inProgressAdded: number;
    inProgressCancelled: number;
    final: number;
    delta: number;
  }>;
}
