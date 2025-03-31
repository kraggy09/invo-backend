import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { redisPublisher, redisSubscriber } from "../config/redis.config";
import { Server as HttpServer } from "http";

interface SocketUser {
  userId: string;
  socketId: string;
  room?: string;
}

interface SocketEvent {
  type: string;
  payload: any;
}

export class SocketService {
  private io: Server;
  private connectedUsers: Map<string, SocketUser>;
  private rooms: Map<string, Set<string>>;

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ["websocket", "polling"],
    });

    this.connectedUsers = new Map();
    this.rooms = new Map();
    this.initializeSocket();
  }

  private async initializeSocket() {
    try {
      // Create Redis adapter
      await this.io.adapter(createAdapter(redisPublisher, redisSubscriber));

      this.io.on("connection", (socket: Socket) => {
        console.log(`Client connected: ${socket.id}`);

        // Handle user connection
        socket.on("user:connect", (userId: string) => {
          this.handleUserConnect(socket, userId);
        });

        // Handle room joining
        socket.on("room:join", (roomId: string) => {
          this.handleRoomJoin(socket, roomId);
        });

        // Handle room leaving
        socket.on("room:leave", (roomId: string) => {
          this.handleRoomLeave(socket, roomId);
        });

        // Handle custom events
        socket.on("message:send", (data: SocketEvent) => {
          this.handleMessageSend(socket, data);
        });

        // Handle disconnection
        socket.on("disconnect", () => {
          this.handleDisconnect(socket);
        });

        // Error handling
        socket.on("error", (error) => {
          console.error("Socket error:", error);
        });
      });

      // Handle Redis adapter errors
      this.io.adapter.on("error", (error) => {
        console.error("Socket adapter error:", error);
      });
    } catch (error) {
      console.error("Failed to initialize socket:", error);
      throw error;
    }
  }

  private handleUserConnect(socket: Socket, userId: string) {
    this.connectedUsers.set(userId, { userId, socketId: socket.id });
    console.log(`User ${userId} connected with socket ${socket.id}`);
  }

  private handleRoomJoin(socket: Socket, roomId: string) {
    socket.join(roomId);
    const user = Array.from(this.connectedUsers.values()).find(
      (u) => u.socketId === socket.id
    );
    if (user) {
      user.room = roomId;
      if (!this.rooms.has(roomId)) {
        this.rooms.set(roomId, new Set());
      }
      this.rooms.get(roomId)?.add(userId);
      console.log(`User ${user.userId} joined room ${roomId}`);
    }
  }

  private handleRoomLeave(socket: Socket, roomId: string) {
    socket.leave(roomId);
    const user = Array.from(this.connectedUsers.values()).find(
      (u) => u.socketId === socket.id
    );
    if (user) {
      user.room = undefined;
      this.rooms.get(roomId)?.delete(userId);
      console.log(`User ${user.userId} left room ${roomId}`);
    }
  }

  private handleMessageSend(socket: Socket, data: SocketEvent) {
    const user = Array.from(this.connectedUsers.values()).find(
      (u) => u.socketId === socket.id
    );
    if (user?.room) {
      this.io.to(user.room).emit("message:receive", {
        ...data,
        sender: user.userId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleDisconnect(socket: Socket) {
    const user = Array.from(this.connectedUsers.values()).find(
      (u) => u.socketId === socket.id
    );
    if (user) {
      if (user.room) {
        this.rooms.get(user.room)?.delete(user.userId);
      }
      this.connectedUsers.delete(user.userId);
      console.log(`User ${user.userId} disconnected`);
    }
  }

  // Public methods for external use
  public getIO(): Server {
    return this.io;
  }

  public emitToUser(userId: string, event: string, data: any) {
    const user = this.connectedUsers.get(userId);
    if (user) {
      this.io.to(user.socketId).emit(event, data);
    }
  }

  public emitToRoom(roomId: string, event: string, data: any) {
    this.io.to(roomId).emit(event, data);
  }

  public broadcast(event: string, data: any) {
    this.io.emit(event, data);
  }

  public getConnectedUsers(): SocketUser[] {
    return Array.from(this.connectedUsers.values());
  }

  public getRoomUsers(roomId: string): string[] {
    return Array.from(this.rooms.get(roomId) || []);
  }
}
