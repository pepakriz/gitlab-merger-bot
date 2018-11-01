import { spawn } from 'child_process';
import * as fs from 'fs';

export class Git {

	private readonly repositoryDir: string;

	private constructor(repositoryDir: string) {
		this.repositoryDir = repositoryDir;

		if (!fs.existsSync(this.repositoryDir)) {
			fs.mkdirSync(this.repositoryDir);
		}
	}

	public static async create(repositoryDir: string): Promise<Git> {
		const self = new Git(repositoryDir);

		if (!fs.existsSync(`${repositoryDir}/.git`)) {
			await Git.runCommand('init', repositoryDir);
		}

		return self;
	}

	public run(command: string): Promise<string> {
		return Git.runCommand(command, this.repositoryDir);
	}

	private static runCommand(command: string, repositoryDir: string): Promise<string> {
		return new Promise((resolve, reject) => {
			let stdout = '';
			let stderr = '';

			console.log(`[git] git ${command}`);

			const child = spawn('git', command.split(' '), {
				cwd: repositoryDir,
			});

			child.stdout.on('data', (data: string) => {
				stdout += data;
			});

			child.stderr.on('data', (data: string) => {
				stderr += data;
			});

			child.on('close', (close: number) => {
				if (close !== 0) {
					reject(new Error(stderr));
					return;
				}

				resolve(stdout);
			});
		});
	}

}
