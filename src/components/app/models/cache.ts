import { PrismaClient } from "prisma/client/cache";

export default class Cache {
	private prisma: PrismaClient;

	public constructor() {
		this.prisma = new PrismaClient();
	}
}
