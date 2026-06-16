import { MembershipRole } from "@calcom/prisma/enums";
import { z } from "zod";

export const ZTeamId = z.object({ teamId: z.number().int().positive() });
export type TTeamId = z.infer<typeof ZTeamId>;

export const ZCreateTeam = z.object({ name: z.string().trim().min(1).max(100) });
export type TCreateTeam = z.infer<typeof ZCreateTeam>;

export const ZInviteMember = z.object({
  teamId: z.number().int().positive(),
  email: z.string().email(),
  role: z.nativeEnum(MembershipRole).default(MembershipRole.MEMBER),
});
export type TInviteMember = z.infer<typeof ZInviteMember>;

export const ZAcceptOrLeave = z.object({
  teamId: z.number().int().positive(),
  accept: z.boolean(),
});
export type TAcceptOrLeave = z.infer<typeof ZAcceptOrLeave>;

export const ZAcceptInviteByToken = z.object({ token: z.string().min(1) });
export type TAcceptInviteByToken = z.infer<typeof ZAcceptInviteByToken>;

export const ZChangeMemberRole = z.object({
  teamId: z.number().int().positive(),
  membershipId: z.number().int().positive(),
  role: z.nativeEnum(MembershipRole),
});
export type TChangeMemberRole = z.infer<typeof ZChangeMemberRole>;

export const ZRemoveMember = z.object({
  teamId: z.number().int().positive(),
  membershipId: z.number().int().positive(),
});
export type TRemoveMember = z.infer<typeof ZRemoveMember>;
