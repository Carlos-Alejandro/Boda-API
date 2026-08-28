declare global {
  namespace Express {
    interface Request {
      admin?: {
        uid: string;
        email?: string;
      };
    }
  }
}

export {};
