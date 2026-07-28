import type { ParticipantRole, StudentGrade } from "@event-roster/contracts";

export const ROLE_LABEL = {
  STUDENT: "학생",
  TEACHER: "담당교사",
} satisfies Record<ParticipantRole, string>;

export const GRADE_LABEL = {
  M1: "중1",
  M2: "중2",
  M3: "중3",
  H1: "고1",
  H2: "고2",
  H3: "고3",
} satisfies Record<StudentGrade, string>;
