const isMuted = () => process.env.FUNCTIONS_EMULATOR === "true";
module.exports = { isMuted };
