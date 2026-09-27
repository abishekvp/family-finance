// Custom entry point (see package.json "main") so the SMS headless task can be registered before
// anything else runs. registerHeadlessTask must be called unconditionally at module scope — Android
// starts this whole JS bundle fresh to run it when the app isn't already open, so registration can't
// wait for a component to mount. `./src/lib/backgroundSync` similarly defines the periodic
// background-sync task at module scope, as expo-task-manager requires.
import { AppRegistry } from "react-native";
import smsHeadlessTask from "./src/tasks/smsHeadlessTask";
import "./src/lib/backgroundSync";

AppRegistry.registerHeadlessTask("SmsSyncTask", () => smsHeadlessTask);

import "expo-router/entry";
