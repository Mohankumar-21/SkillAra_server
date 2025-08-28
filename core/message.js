const messages = {
  100: "Tenant created successfully",
  101: "Unexpected error occured",
};

export const getMessage = (code) => {
  return messages[code] || "Unknown error";
};
