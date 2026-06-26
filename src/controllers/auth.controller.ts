import { catchAsync } from "../utils/catchAsync";
import { getAuth } from "@clerk/express";
import AuthError from "../errors/AuthError";
import { authService } from "../services/auth.service";
import AppError from "../errors/AppError";

export const registerUserOrLogin = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const result = await authService(userId);
  if(!result) throw new AppError({
    message :'error creating user',
    statusCode:500,
    type:'INTERNAL_SERVER_ERROR'
  })

  return res.status(200).json(result)
});
