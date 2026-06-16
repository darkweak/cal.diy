import { Dialog } from "@calcom/features/components/controlled-dialog";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { MembershipRole } from "@calcom/prisma/enums";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { DialogContent, DialogFooter } from "@calcom/ui/components/dialog";
import { EmailField, Label, Select } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { useSession } from "next-auth/react";
import type { Dispatch } from "react";
import { useState } from "react";
import type { UserTableAction } from "./types";

interface Props {
  dispatch: Dispatch<UserTableAction>;
}

const ROLE_OPTIONS = [
  { value: MembershipRole.MEMBER, label: "Member" },
  { value: MembershipRole.ADMIN, label: "Admin" },
  { value: MembershipRole.OWNER, label: "Owner" },
];

export function InviteMemberModal(props: Props) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(ROLE_OPTIONS[0]);

  // The org is represented as a team row, so its members are managed via the same endpoint.
  const teamId = session?.user.org?.id;

  const inviteMember = trpc.viewer.teams.inviteMember.useMutation({
    onSuccess: () => {
      showToast(t("invitation_sent"), "success");
      utils.viewer.teams.listMembers.invalidate();
      props.dispatch({ type: "CLOSE_MODAL" });
    },
    onError: (e) => showToast(e.message, "error"),
  });

  if (!teamId) return null;

  return (
    <Dialog open={true} onOpenChange={() => props.dispatch({ type: "CLOSE_MODAL" })}>
      <DialogContent title={t("invite_team_member")} type="creation">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            inviteMember.mutate({ teamId, email, role: role.value });
          }}>
          <div className="space-y-4">
            <EmailField
              label={t("email")}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div>
              <Label>{t("role")}</Label>
              <Select options={ROLE_OPTIONS} value={role} onChange={(opt) => opt && setRole(opt)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" color="secondary" onClick={() => props.dispatch({ type: "CLOSE_MODAL" })}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={inviteMember.isPending}>
              {t("send_invite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
