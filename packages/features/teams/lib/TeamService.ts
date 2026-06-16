import TeamInviteEmail from "@calcom/emails/templates/team-invite-email";
import { getTranslation } from "@calcom/i18n/server";
import { APP_NAME, WEBAPP_URL } from "@calcom/lib/constants";
import { ErrorWithCode } from "@calcom/lib/errors";
import { slugify } from "@calcom/lib/slugify";
import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";
import { randomBytes } from "crypto";

type ManagerRole = typeof MembershipRole.OWNER | typeof MembershipRole.ADMIN;
const MANAGER_ROLES: ManagerRole[] = [MembershipRole.OWNER, MembershipRole.ADMIN];
const INVITE_TOKEN_TTL_DAYS = 7;

/**
 * Minimal, self-contained team management for self-hosted deployments.
 *
 * Handles team creation, membership invitations (by email, with email delivery),
 * accepting/declining invites, role changes and member removal. Deliberately
 * excludes billing, seats and organization concerns — the DB schema supports
 * those, but they are out of scope for the community build.
 */
export class TeamService {
  /** Returns the membership of `userId` in `teamId`, or throws NotFound. */
  private async getMembershipOrThrow(teamId: number, userId: number) {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { id: true, role: true, accepted: true },
    });
    if (!membership) throw ErrorWithCode.Factory.NotFound("You are not a member of this team");
    return membership;
  }

  /** Asserts the caller is an accepted OWNER/ADMIN of the team. Returns their role. */
  private async assertManager(teamId: number, userId: number): Promise<MembershipRole> {
    const membership = await this.getMembershipOrThrow(teamId, userId);
    if (!membership.accepted || !MANAGER_ROLES.includes(membership.role as ManagerRole)) {
      throw ErrorWithCode.Factory.Forbidden("You don't have permission to manage this team");
    }
    return membership.role;
  }

  /** Teams the user belongs to, including pending invitations. */
  async listForUser(userId: number) {
    const memberships = await prisma.membership.findMany({
      where: { userId },
      select: {
        role: true,
        accepted: true,
        team: {
          select: { id: true, name: true, slug: true, logoUrl: true, _count: { select: { members: true } } },
        },
      },
      orderBy: { team: { name: "asc" } },
    });
    return memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      logoUrl: m.team.logoUrl,
      role: m.role,
      accepted: m.accepted,
      memberCount: m.team._count.members,
    }));
  }

  /** Members of a team. Caller must be a member. */
  async listMembers(teamId: number, callerId: number) {
    await this.getMembershipOrThrow(teamId, callerId);
    const memberships = await prisma.membership.findMany({
      where: { teamId },
      select: {
        id: true,
        role: true,
        accepted: true,
        user: { select: { id: true, name: true, email: true, username: true, avatarUrl: true } },
      },
      orderBy: { id: "asc" },
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      accepted: m.accepted,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
    }));
  }

  /** Creates a team with the caller as accepted OWNER. */
  async create({ name, userId }: { name: string; userId: number }) {
    const slug = await this.generateUniqueSlug(name);
    const team = await prisma.team.create({
      data: {
        name,
        slug,
        members: { create: { userId, role: MembershipRole.OWNER, accepted: true } },
      },
      select: { id: true, name: true, slug: true },
    });
    return team;
  }

  private async generateUniqueSlug(name: string) {
    const base = slugify(name) || "team";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
      const existing = await prisma.team.findFirst({
        where: { slug: candidate, parentId: null },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    return `${base}-${randomBytes(4).toString("hex")}`;
  }

  /**
   * Invites a user to a team by email.
   * - Existing user: a pending membership is created immediately and they get an invite email.
   * - New user: a tokenized invite email is sent; the membership is created when they accept after signup.
   */
  async inviteMember({
    teamId,
    inviterId,
    email,
    role,
  }: {
    teamId: number;
    inviterId: number;
    email: string;
    role: MembershipRole;
  }) {
    await this.assertManager(teamId, inviterId);

    const normalizedEmail = email.trim().toLowerCase();
    const [team, inviter, invitee] = await Promise.all([
      prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: inviterId }, select: { name: true, email: true } }),
      prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, locale: true },
      }),
    ]);
    if (!team) throw ErrorWithCode.Factory.NotFound("Team not found");

    const token = randomBytes(32).toString("hex");
    const expires = new Date();
    expires.setDate(expires.getDate() + INVITE_TOKEN_TTL_DAYS);

    if (invitee) {
      const existing = await prisma.membership.findUnique({
        where: { userId_teamId: { userId: invitee.id, teamId } },
        select: { accepted: true },
      });
      if (existing?.accepted) {
        throw ErrorWithCode.Factory.BadRequest("This user is already a member of the team");
      }
      await prisma.membership.upsert({
        where: { userId_teamId: { userId: invitee.id, teamId } },
        update: { role },
        create: { userId: invitee.id, teamId, role, accepted: false },
      });
    }

    await prisma.verificationToken.create({
      data: { identifier: normalizedEmail, token, expires, teamId, expiresInDays: INVITE_TOKEN_TTL_DAYS },
    });

    const joinLink = invitee
      ? `${WEBAPP_URL}/settings/teams`
      : `${WEBAPP_URL}/signup?token=${token}&callbackUrl=/settings/teams`;

    await this.sendInviteEmail({
      to: normalizedEmail,
      fromName: inviter?.name || inviter?.email || APP_NAME,
      teamName: team.name,
      joinLink,
      isExistingUser: !!invitee,
      locale: invitee?.locale ?? "en",
    });

    return { sent: true, invitedExistingUser: !!invitee };
  }

  private async sendInviteEmail({
    to,
    fromName,
    teamName,
    joinLink,
    isExistingUser,
    locale,
  }: {
    to: string;
    fromName: string;
    teamName: string;
    joinLink: string;
    isExistingUser: boolean;
    locale: string;
  }) {
    const translation = await getTranslation(locale, "common");
    await new TeamInviteEmail({
      language: translation,
      from: fromName,
      to,
      teamName,
      joinLink,
      isCalcomMember: isExistingUser,
      isAutoJoin: false,
      isOrg: false,
      parentTeamName: undefined,
      isExistingUserMovedToOrg: false,
      prevLink: null,
      newLink: null,
    }).sendEmail();
  }

  /** Accept (accepted=true) or decline/leave (delete membership) the caller's own membership. */
  async acceptOrLeave({ teamId, userId, accept }: { teamId: number; userId: number; accept: boolean }) {
    const membership = await this.getMembershipOrThrow(teamId, userId);
    if (accept) {
      await prisma.membership.update({ where: { id: membership.id }, data: { accepted: true } });
      return { accepted: true };
    }
    if (membership.role === MembershipRole.OWNER) await this.assertNotLastOwner(teamId, userId);
    await prisma.membership.delete({ where: { id: membership.id } });
    return { accepted: false };
  }

  /** Accept a tokenized invite after the invitee has an account whose email matches the token. */
  async acceptInviteByToken({ token, userId }: { token: string; userId: number }) {
    const invite = await prisma.verificationToken.findUnique({
      where: { token },
      select: { id: true, identifier: true, expires: true, teamId: true },
    });
    if (!invite || !invite.teamId) throw ErrorWithCode.Factory.NotFound("Invite not found");
    if (invite.expires < new Date()) throw ErrorWithCode.Factory.BadRequest("This invite has expired");

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user || user.email.toLowerCase() !== invite.identifier.toLowerCase()) {
      throw ErrorWithCode.Factory.Forbidden("This invite was sent to a different email address");
    }

    await prisma.membership.upsert({
      where: { userId_teamId: { userId, teamId: invite.teamId } },
      update: { accepted: true },
      create: { userId, teamId: invite.teamId, role: MembershipRole.MEMBER, accepted: true },
    });
    await prisma.verificationToken.delete({ where: { id: invite.id } });
    return { teamId: invite.teamId };
  }

  async changeMemberRole({
    teamId,
    callerId,
    membershipId,
    role,
  }: {
    teamId: number;
    callerId: number;
    membershipId: number;
    role: MembershipRole;
  }) {
    await this.assertManager(teamId, callerId);
    const target = await this.getMembershipInTeamOrThrow(membershipId, teamId);
    // Demoting the last owner would leave the team ownerless.
    if (target.role === MembershipRole.OWNER && role !== MembershipRole.OWNER) {
      await this.assertNotLastOwner(teamId, target.userId);
    }
    await prisma.membership.update({ where: { id: membershipId }, data: { role } });
    return { membershipId, role };
  }

  async removeMember({
    teamId,
    callerId,
    membershipId,
  }: {
    teamId: number;
    callerId: number;
    membershipId: number;
  }) {
    const target = await this.getMembershipInTeamOrThrow(membershipId, teamId);
    const isSelf = target.userId === callerId;
    if (!isSelf) await this.assertManager(teamId, callerId);
    if (target.role === MembershipRole.OWNER) await this.assertNotLastOwner(teamId, target.userId);
    await prisma.membership.delete({ where: { id: membershipId } });
    return { membershipId };
  }

  private async getMembershipInTeamOrThrow(membershipId: number, teamId: number) {
    const membership = await prisma.membership.findUnique({
      where: { id: membershipId },
      select: { id: true, role: true, userId: true, teamId: true },
    });
    if (!membership || membership.teamId !== teamId) {
      throw ErrorWithCode.Factory.NotFound("Member not found in this team");
    }
    return membership;
  }

  private async assertNotLastOwner(teamId: number, ownerUserId: number) {
    const otherOwners = await prisma.membership.count({
      where: { teamId, role: MembershipRole.OWNER, accepted: true, userId: { not: ownerUserId } },
    });
    if (otherOwners === 0) {
      throw ErrorWithCode.Factory.BadRequest("A team must have at least one owner");
    }
  }
}
