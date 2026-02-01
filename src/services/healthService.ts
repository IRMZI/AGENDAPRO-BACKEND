export const getHealth = () => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
};
