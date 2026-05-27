
class AppError extends Error{
  public statusCode: number;
  public type: string;
  public isOperational: boolean;
  public details: any;

  constructor({
    message,
    statusCode = 500,
    type="INTERNAL_ERROR",
    isOperational = true,
    details = null
  }: {
    message: string;
    statusCode?: number;
    type?: string;
    isOperational?: boolean;
    details?: any;
  }){
    super(message)
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.type = type;
    this.isOperational = isOperational
    this.details = details;

    Error.captureStackTrace(this,this.constructor)

  }

}

export default AppError;