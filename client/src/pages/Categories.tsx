import { useOutletContext } from "react-router-dom";
import type { LayoutContext } from "../components/Layout";
import { CategoryManager } from "../components/settings/CategoryManager";

export function Categories() {
  const { family } = useOutletContext<LayoutContext>();
  return (
    <div>
      <CategoryManager familyId={family.id} role={family.role} />
    </div>
  );
}
