/*
 * Study server + invite baked into the build (extension/study.config.json, overridable with the env vars
 * CM_SERVER_URL / CM_INVITE_TOKEN at build time). With it, a tester installs the extension, agrees once on
 * the welcome page and is done; without it (empty token) the popup asks for an invite code.
 */
declare const __STUDY_CONFIG__: { serverUrl: string; inviteToken: string } | undefined;

export const STUDY_CONFIG: { serverUrl: string; inviteToken: string } =
  typeof __STUDY_CONFIG__ !== "undefined" && __STUDY_CONFIG__ ? __STUDY_CONFIG__ : { serverUrl: "http://localhost:8787", inviteToken: "" };
