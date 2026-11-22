// Entry point. ?tv is the big screen; ?play or ?room=CODE is a handle. With neither, a phone
// gets the handle view and anything bigger (laptop, TV, tablet) becomes the big screen.
import { startPhone } from "./phone.js";
import { startTv } from "./tv.js";

const params = new URLSearchParams(location.search);
const phoneish = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 700;
if (params.has("tv") || (!params.has("play") && !params.has("room") && !phoneish)) startTv();
else startPhone();
