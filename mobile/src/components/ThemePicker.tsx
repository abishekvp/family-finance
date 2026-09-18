import { useTheme, type ThemeChoice } from "../context/ThemeContext";
import { Segmented } from "./ui";

/** Light / Dark / System picker, shared by the "More" tab. */
export function ThemePicker() {
  const { choice, setChoice } = useTheme();
  return (
    <Segmented<ThemeChoice>
      fullWidth
      value={choice}
      onChange={setChoice}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ]}
    />
  );
}
