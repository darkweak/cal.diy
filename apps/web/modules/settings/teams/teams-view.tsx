"use client";

import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { MembershipRole } from "@calcom/prisma/enums";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import { Label, Select, TextField } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { useState } from "react";

type RoleOption = { value: MembershipRole; label: string };

const ROLE_OPTIONS: RoleOption[] = [
  { value: MembershipRole.MEMBER, label: "Member" },
  { value: MembershipRole.ADMIN, label: "Admin" },
  { value: MembershipRole.OWNER, label: "Owner" },
];

const canManage = (role: MembershipRole) => role === MembershipRole.OWNER || role === MembershipRole.ADMIN;

function TeamMembers({ teamId, myRole }: { teamId: number; myRole: MembershipRole }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const membersQuery = trpc.viewer.teams.listMembers.useQuery({ teamId });
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleOption>(ROLE_OPTIONS[0]);

  const invite = trpc.viewer.teams.inviteMember.useMutation({
    onSuccess: () => {
      setEmail("");
      showToast(t("invitation_sent"), "success");
      utils.viewer.teams.listMembers.invalidate({ teamId });
    },
    onError: (e) => showToast(e.message, "error"),
  });

  const changeRole = trpc.viewer.teams.changeMemberRole.useMutation({
    onSuccess: () => {
      showToast(t("success"), "success");
      utils.viewer.teams.listMembers.invalidate({ teamId });
    },
    onError: (e) => showToast(e.message, "error"),
  });

  const removeMember = trpc.viewer.teams.removeMember.useMutation({
    onSuccess: () => {
      showToast(t("success"), "success");
      utils.viewer.teams.listMembers.invalidate({ teamId });
      utils.viewer.teams.list.invalidate();
    },
    onError: (e) => showToast(e.message, "error"),
  });

  const manage = canManage(myRole);

  return (
    <div className="border-subtle mt-2 rounded-md border p-4">
      {manage && (
        <form
          className="mb-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate({ teamId, email, role: inviteRole.value });
          }}>
          <div className="flex-1">
            <TextField
              label={t("invite_team_member") || "Invite member"}
              type="email"
              required
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Label>{t("role")}</Label>
            <Select options={ROLE_OPTIONS} value={inviteRole} onChange={(opt) => opt && setInviteRole(opt)} />
          </div>
          <Button type="submit" loading={invite.isPending}>
            {t("invite")}
          </Button>
        </form>
      )}

      <ul className="divide-subtle divide-y">
        {membersQuery.data?.map((m) => (
          <li key={m.membershipId} className="flex items-center justify-between py-2">
            <div>
              <p className="text-emphasis text-sm font-medium">{m.name || m.email}</p>
              <p className="text-subtle text-xs">
                {m.email}
                {!m.accepted ? ` · ${t("pending")}` : ""}
              </p>
            </div>
            {manage ? (
              <div className="flex items-center gap-2">
                <div className="w-36">
                  <Select
                    options={ROLE_OPTIONS}
                    value={ROLE_OPTIONS.find((r) => r.value === m.role)}
                    onChange={(opt) =>
                      opt && changeRole.mutate({ teamId, membershipId: m.membershipId, role: opt.value })
                    }
                  />
                </div>
                <Button
                  color="destructive"
                  variant="icon"
                  StartIcon="trash"
                  onClick={() => {
                    if (confirm(t("remove_member_confirmation_message") || "Remove this member?")) {
                      removeMember.mutate({ teamId, membershipId: m.membershipId });
                    }
                  }}
                />
              </div>
            ) : (
              <span className="text-subtle text-xs capitalize">{m.role.toLowerCase()}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TeamsView() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const teamsQuery = trpc.viewer.teams.list.useQuery();
  const [newTeamName, setNewTeamName] = useState("");
  const [openTeamId, setOpenTeamId] = useState<number | null>(null);

  const createTeam = trpc.viewer.teams.create.useMutation({
    onSuccess: () => {
      setNewTeamName("");
      showToast(t("success"), "success");
      utils.viewer.teams.list.invalidate();
    },
    onError: (e) => showToast(e.message, "error"),
  });

  const acceptOrLeave = trpc.viewer.teams.acceptOrLeave.useMutation({
    onSuccess: () => utils.viewer.teams.list.invalidate(),
    onError: (e) => showToast(e.message, "error"),
  });

  return (
    <SettingsHeader title={t("teams")} description={t("create_manage_teams_collaborative") || ""}>
      <form
        className="border-subtle mb-6 flex items-end gap-2 rounded-md border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          createTeam.mutate({ name: newTeamName });
        }}>
        <div className="flex-1">
          <TextField
            label={t("create_a_team") || "Create a team"}
            required
            placeholder={t("team_name") || "Team name"}
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
        </div>
        <Button type="submit" loading={createTeam.isPending}>
          {t("create")}
        </Button>
      </form>

      {!teamsQuery.data?.length ? (
        <EmptyScreen
          Icon="users"
          headline={t("teams")}
          description={t("create_manage_teams_collaborative") || "Create a team to collaborate."}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {teamsQuery.data.map((team) => (
            <li key={team.id} className="border-subtle rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-emphasis font-medium">{team.name}</p>
                  <p className="text-subtle text-xs capitalize">
                    {team.role.toLowerCase()} · {team.memberCount} {t("members").toLowerCase()}
                  </p>
                </div>
                {team.accepted ? (
                  <Button
                    color="secondary"
                    onClick={() => setOpenTeamId(openTeamId === team.id ? null : team.id)}>
                    {openTeamId === team.id ? t("close") : t("manage")}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      color="primary"
                      loading={acceptOrLeave.isPending}
                      onClick={() => acceptOrLeave.mutate({ teamId: team.id, accept: true })}>
                      {t("accept")}
                    </Button>
                    <Button
                      color="destructive"
                      loading={acceptOrLeave.isPending}
                      onClick={() => acceptOrLeave.mutate({ teamId: team.id, accept: false })}>
                      {t("reject")}
                    </Button>
                  </div>
                )}
              </div>
              {team.accepted && openTeamId === team.id && <TeamMembers teamId={team.id} myRole={team.role} />}
            </li>
          ))}
        </ul>
      )}
    </SettingsHeader>
  );
}
