import { z } from "zod";

export const ParticipantRoleSchema = z.enum(["STUDENT", "TEACHER"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const StudentGradeSchema = z.enum(["M1", "M2", "M3", "H1", "H2", "H3"]);
export type StudentGrade = z.infer<typeof StudentGradeSchema>;

export const GenderSchema = z.enum(["MALE", "FEMALE"]);
export type Gender = z.infer<typeof GenderSchema>;
