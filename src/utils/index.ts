import moment from "moment-timezone";

export const getCurrentDateAndTime = () => {
  return moment().tz("Asia/Kolkata").format(); // or format according to your needs
};

export const getDate = () => {
  const IST = "Asia/Kolkata";
  const currentDate = moment().tz(IST).format("DD-MM-YYYY");
  return currentDate;
};

export const getCurrentDateOfUser = (date: Date) => {
  const IST = "Asia/Kolkata";
  const currentDate = moment(date).tz(IST).format("DD-MM-YYYY");
  return currentDate;
};
