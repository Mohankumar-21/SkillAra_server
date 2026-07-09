const messages = {
  100: "Tenant created successfully",
  102: "Tenant list fetched successfully",
  103: "Tenant resolved successfully",
  101: "Unexpected error occured",
  150: "Validation failed",
  151: "Tenant not found",
  200: "User registered successfully",
  201: "Users fetched successfully",
  202: "User created successfully",
  203: "User updated successfully",
};

export const getMessage = (code) => {
  return messages[code] || "Unknown error";
};
