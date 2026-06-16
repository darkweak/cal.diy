import { TeamService } from "@calcom/features/teams/lib/TeamService";
import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import {
  ZAcceptInviteByToken,
  ZAcceptOrLeave,
  ZChangeMemberRole,
  ZCreateTeam,
  ZInviteMember,
  ZRemoveMember,
  ZTeamId,
} from "./schemas";

const teamService = new TeamService();

export const teamsRouter = router({
  // Teams the current user belongs to (including pending invitations)
  list: authedProcedure.query(({ ctx }) => teamService.listForUser(ctx.user.id)),

  // Members of a team (caller must be a member)
  listMembers: authedProcedure
    .input(ZTeamId)
    .query(({ ctx, input }) => teamService.listMembers(input.teamId, ctx.user.id)),

  create: authedProcedure
    .input(ZCreateTeam)
    .mutation(({ ctx, input }) => teamService.create({ name: input.name, userId: ctx.user.id })),

  inviteMember: authedProcedure.input(ZInviteMember).mutation(({ ctx, input }) =>
    teamService.inviteMember({
      teamId: input.teamId,
      inviterId: ctx.user.id,
      email: input.email,
      role: input.role,
    })
  ),

  acceptOrLeave: authedProcedure
    .input(ZAcceptOrLeave)
    .mutation(({ ctx, input }) =>
      teamService.acceptOrLeave({ teamId: input.teamId, userId: ctx.user.id, accept: input.accept })
    ),

  acceptInviteByToken: authedProcedure
    .input(ZAcceptInviteByToken)
    .mutation(({ ctx, input }) =>
      teamService.acceptInviteByToken({ token: input.token, userId: ctx.user.id })
    ),

  changeMemberRole: authedProcedure.input(ZChangeMemberRole).mutation(({ ctx, input }) =>
    teamService.changeMemberRole({
      teamId: input.teamId,
      callerId: ctx.user.id,
      membershipId: input.membershipId,
      role: input.role,
    })
  ),

  removeMember: authedProcedure.input(ZRemoveMember).mutation(({ ctx, input }) =>
    teamService.removeMember({
      teamId: input.teamId,
      callerId: ctx.user.id,
      membershipId: input.membershipId,
    })
  ),
});
