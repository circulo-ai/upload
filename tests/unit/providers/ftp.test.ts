import { Readable, type Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  FtpStorageProvider,
  type FtpAccessOptions,
  type FtpClient,
} from "../../../src/providers/ftp";

class MemoryFtpClient implements FtpClient {
  readonly files = new Map<string, Buffer>();
  readonly accessCalls: FtpAccessOptions[] = [];
  readonly directories: string[] = [];
  closed = 0;

  async access(options: FtpAccessOptions): Promise<void> {
    this.accessCalls.push(options);
  }

  async ensureDir(remotePath: string): Promise<void> {
    this.directories.push(remotePath);
  }

  async uploadFrom(source: Readable, remotePath: string): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of source) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    this.files.set(remotePath, Buffer.concat(chunks));
  }

  async downloadTo(destination: Writable, remotePath: string): Promise<void> {
    const file = this.files.get(remotePath);
    if (!file) throw new Error("File not found");
    destination.end(file);
  }

  async remove(remotePath: string): Promise<void> {
    this.files.delete(remotePath);
  }

  close(): void {
    this.closed += 1;
  }
}

describe("FtpStorageProvider", () => {
  it("adapts upload, download, and delete to an FTP client", async () => {
    const client = new MemoryFtpClient();
    const provider = new FtpStorageProvider({
      host: "ftp.example.test",
      user: "user",
      password: "secret",
      secure: true,
      rootDirectory: "/srv/uploads",
      pathPrefix: "chat",
      clientFactory: () => client,
    });

    const uploaded = await provider.upload({
      file: Buffer.from("hello"),
      fileName: "hello.txt",
      contentType: "text/plain",
      customKey: "messages/hello.txt",
    });

    expect(uploaded.key).toBe("chat/messages/hello.txt");
    expect(client.files.get("/srv/uploads/chat/messages/hello.txt")).toEqual(
      Buffer.from("hello"),
    );
    expect(await provider.download({ key: uploaded.key })).toEqual(
      Buffer.from("hello"),
    );

    await provider.delete({ key: uploaded.key });
    expect(client.files.size).toBe(0);
    expect(client.accessCalls[0]).toMatchObject({
      host: "ftp.example.test",
      user: "user",
      secure: true,
    });
    expect(client.closed).toBe(3);
  });

  it("rejects parent-directory traversal", async () => {
    const provider = new FtpStorageProvider({
      host: "ftp.example.test",
      clientFactory: () => new MemoryFtpClient(),
    });

    await expect(provider.download({ key: "../secret.txt" })).rejects.toThrow(
      "parent-directory",
    );
  });

  it("does not advertise unsupported FTP capabilities", () => {
    const provider = new FtpStorageProvider({ host: "ftp.example.test" });

    expect(provider.supportsPresignedUrls()).toBe(false);
    expect(provider.supportsMultipartUpload()).toBe(false);
  });
});
