import jwt from "jsonwebtoken";

export const generateToken = async (userId: string) => {
  const secret = process.env.JWT_SECRET || "dummy_secret";
  try {
    const token = jwt.sign({ userId }, secret, {
      expiresIn: "15d", // Token expires in 15 days
    });
    console.log(token);
    return token;
  } catch (error) {
    console.error("Error generating token:", error);
    return null;
  }
};
