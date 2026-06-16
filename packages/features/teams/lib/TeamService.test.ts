import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { MembershipRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamService } from "./TeamService";

const service = new TeamService();

describe("TeamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates a team with the caller as accepted OWNER", async () => {
      prismaMock.team.findFirst.mockResolvedValue(null); // slug is free
      prismaMock.team.create.mockResolvedValue({ id: 1, name: "Acme", slug: "acme" } as never);

      const team = await service.create({ name: "Acme", userId: 7 });

      expect(team).toEqual({ id: 1, name: "Acme", slug: "acme" });
      expect(prismaMock.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Acme",
            members: { create: { userId: 7, role: MembershipRole.OWNER, accepted: true } },
          }),
        })
      );
    });
  });

  describe("inviteMember", () => {
    it("forbids a non-manager from inviting", async () => {
      prismaMock.membership.findUnique.mockResolvedValue({
        id: 1,
        role: MembershipRole.MEMBER,
        accepted: true,
      } as never);

      await expect(
        service.inviteMember({ teamId: 1, inviterId: 7, email: "x@y.com", role: MembershipRole.MEMBER })
      ).rejects.toMatchObject({ code: ErrorCode.Forbidden });
    });

    it("rejects inviting an already-accepted member", async () => {
      // caller is an accepted ADMIN
      prismaMock.membership.findUnique
        .mockResolvedValueOnce({ id: 1, role: MembershipRole.ADMIN, accepted: true } as never)
        // invitee already an accepted member
        .mockResolvedValueOnce({ accepted: true } as never);
      prismaMock.team.findUnique.mockResolvedValue({ id: 1, name: "Acme" } as never);
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ name: "Boss", email: "boss@y.com" } as never) // inviter
        .mockResolvedValueOnce({ id: 9, locale: "en" } as never); // invitee

      await expect(
        service.inviteMember({ teamId: 1, inviterId: 7, email: "dup@y.com", role: MembershipRole.MEMBER })
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });
  });

  describe("removeMember", () => {
    it("prevents removing the last owner", async () => {
      prismaMock.membership.findUnique.mockResolvedValue({
        id: 5,
        role: MembershipRole.OWNER,
        userId: 7,
        teamId: 1,
      } as never);
      prismaMock.membership.count.mockResolvedValue(0); // no other owners

      await expect(service.removeMember({ teamId: 1, callerId: 7, membershipId: 5 })).rejects.toMatchObject({
        code: ErrorCode.BadRequest,
      });
      expect(prismaMock.membership.delete).not.toHaveBeenCalled();
    });

    it("allows a manager to remove a regular member", async () => {
      // target membership
      prismaMock.membership.findUnique
        .mockResolvedValueOnce({ id: 8, role: MembershipRole.MEMBER, userId: 9, teamId: 1 } as never)
        // caller manager lookup inside assertManager
        .mockResolvedValueOnce({ id: 1, role: MembershipRole.OWNER, accepted: true } as never);
      prismaMock.membership.delete.mockResolvedValue({ id: 8 } as never);

      const res = await service.removeMember({ teamId: 1, callerId: 7, membershipId: 8 });

      expect(res).toEqual({ membershipId: 8 });
      expect(prismaMock.membership.delete).toHaveBeenCalledWith({ where: { id: 8 } });
    });
  });

  describe("changeMemberRole", () => {
    it("blocks demoting the last owner", async () => {
      // assertManager: caller is owner
      prismaMock.membership.findUnique
        .mockResolvedValueOnce({ id: 1, role: MembershipRole.OWNER, accepted: true } as never)
        // target is the owner being demoted
        .mockResolvedValueOnce({ id: 1, role: MembershipRole.OWNER, userId: 7, teamId: 1 } as never);
      prismaMock.membership.count.mockResolvedValue(0); // no other owners

      await expect(
        service.changeMemberRole({ teamId: 1, callerId: 7, membershipId: 1, role: MembershipRole.MEMBER })
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
      expect(prismaMock.membership.update).not.toHaveBeenCalled();
    });
  });
});
