/**
 * The settings scenario renders from the *real* schema table, through the
 * real `describeSettings`, so the page is checked against what the server
 * would actually send rather than a hand-written stand-in. Same reasoning
 * as the tool-activity fixture: a scenario that builds its own rows stops
 * failing when the producer changes.
 */
export { describeSettings } from "../../../core/configschema.js";
export { DEFAULT_CONFIG as DEFAULTS_FOR_RENDER_CHECK } from "../../../core/config.js";
