import { useOutletContext } from "react-router-dom";
import type { LayoutContext } from "../components/Layout";
import { GoalManager } from "../components/settings/GoalManager";

export function Goals() {
  const { family } = useOutletContext<LayoutContext>();
  return (
    <div className="mx-auto max-w-3xl">
      <GoalManager familyId={family.id} currency={family.currency} />
    </div>
  );
}
