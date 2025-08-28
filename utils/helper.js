// helpers.js
export const prepareResponseMsg = (data, status, msg, statusCode, limit = 0, totalCount = 0) => {
  const responseObject = {
    status: status,
    data: data,
    message: {
      message: "",
      errorMessage: "",
      code: statusCode,
    },
    pagination: {
      totalPages: limit ? Math.ceil(totalCount / Number(limit)) : 0,
      totalRecords: totalCount,
    },
  };

  if (status) {
    responseObject.message.message = msg;
  } else {
    responseObject.message.errorMessage = msg;
  }

  return responseObject;
};
