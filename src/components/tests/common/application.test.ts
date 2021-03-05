import Application, { handle } from "../../common/application.abstract";
import { sleep } from "../../common/utils.class";
import {
	IComponentOptions,
	IComponentType
} from "../../common/component.interface";

describe("Application", () => {
	/**
	 * Test application with a single component
	 */
	it("singleComponent", async () => {
		const create = jest.fn();
		const close = jest.fn();
		const initialize = jest.fn();
		class MockComponent {
			public static type = "Controllers";
			public name = "Test";
			public constructor(...args: any) {
				create();
			}
			public async initialize(): Promise<void> {
				initialize();
			}
			public close(): void {
				close();
			}
			public static get relations(): null {
				return null;
			}
		}

		class App extends Application {}

		const components: IComponentType[] = [MockComponent];
		const app = new App(components);
		app.logging = false;

		await app.close();
		expect(close).not.toBeCalled();

		expect(create).toBeCalledTimes(1);
		expect(app["components"].length).toBe(1);

		const component = app["getComponents"](MockComponent as any);
		expect(component).toBeInstanceOf(Array);
		expect(component).toHaveLength(1);
		expect(component[0]).toBeInstanceOf(MockComponent);

		await app.initialize().then(() => {
			expect(initialize).toBeCalledTimes(1);
		});

		await app.close();
		expect(close).toBeCalledTimes(1);
	});

	/**
	 * Test application with multiple components
	 * of different types
	 */
	it("multipleComponents", async () => {
		const create = jest.fn();
		const close = jest.fn();
		const initialize = jest.fn();
		console.log = jest.fn();

		class MockControllerComponent {
			public static type = "Controllers";
			public name = "TestController";
			public constructor(...args: any) {
				create();
			}
			public async initialize(): Promise<void> {
				initialize();
			}
			public close(): void {
				close();
			}
			public static get relations(): null {
				return null;
			}
		}
		class MockServiceComponent {
			public static type = "Services";
			public name = "TestService";
			public constructor(...args: any) {
				create();
			}
			public async initialize(): Promise<void> {
				initialize();
			}
			public close(): void {
				close();
			}
			public static get relations(): null {
				return null;
			}
		}
		class MockViewComponent {
			public static type = "Views";
			public name = "TestView";
			public constructor(...args: any) {
				create();
			}
			public async initialize(): Promise<void> {
				initialize();
			}
			public close(): void {
				close();
			}
			public static get relations(): null {
				return null;
			}
		}
		class App extends Application {}

		const components: IComponentType[] = [
			MockControllerComponent,
			MockServiceComponent,
			MockViewComponent
		];
		const app = new App(components);

		expect(create).toBeCalledTimes(3);
		expect(app["components"].length).toBe(3);
		expect(app["components"][0]).toBeInstanceOf(MockServiceComponent);
		expect(app["components"][1]).toBeInstanceOf(MockViewComponent);
		expect(app["components"][2]).toBeInstanceOf(MockControllerComponent);

		let component = app["getComponents"](MockControllerComponent as any);
		expect(component).toBeInstanceOf(Array);
		expect(component).toHaveLength(1);
		expect(component[0]).toBeInstanceOf(MockControllerComponent);

		component = app["getComponents"](MockServiceComponent as any);
		expect(component).toBeInstanceOf(Array);
		expect(component).toHaveLength(1);
		expect(component[0]).toBeInstanceOf(MockServiceComponent);

		component = app["getComponents"](MockViewComponent as any);
		expect(component).toBeInstanceOf(Array);
		expect(component).toHaveLength(1);
		expect(component[0]).toBeInstanceOf(MockViewComponent);

		await app.initialize().then(() => {
			expect(initialize).toBeCalledTimes(3);
		});

		await app.close();
		expect(close).toBeCalledTimes(3);
		expect(console.log).toBeCalled();
	});

	/**
	 * Test application with duplicate components
	 * with multiple relations of the same type
	 */
	it("relationalComponents", async () => {
		const create = jest.fn();
		const close = jest.fn();
		const initialize = jest.fn();
		class MockRelationalComponent {
			public static type = "Controllers";
			public name = "TestController";
			public constructor(...args: any) {
				create();
			}
			public async initialize(): Promise<void> {
				initialize();
			}
			public close(): void {
				close();
			}
			public static get relations(): object[] {
				return [{}, {}, {}, {}];
			}
		}
		class App extends Application {}

		const components: IComponentType[] = [MockRelationalComponent];
		const app = new App(components);
		app.logging = false;

		expect(app["components"].length).toBe(4);
		expect(create).toBeCalledTimes(4);

		const component = app["getComponents"](MockRelationalComponent);
		expect(component).toBeInstanceOf(Array);
		expect(component).toHaveLength(4);
		for (let i = 0; i < component.length; i++) {
			expect(component[i]).toBeInstanceOf(MockRelationalComponent);
		}

		await app.initialize().then(() => {
			expect(initialize).toBeCalledTimes(4);
		});

		await app.close();
		expect(close).toBeCalledTimes(4);
	});

	/**
	 * Test that initialization arguments
	 * are passed into componets
	 */
	it("componentConfigurations", async () => {
		const init = jest.fn();
		class MockComponent1 {
			public static type = "Controllers";
			public name = "TestController";
			public initialize(arg1: string, arg2: number): void {
				expect(arg1).toBe("arg1");
				expect(arg2).toBe(2);
				init();
			}
			public static get relations(): null {
				return null;
			}
		}
		class MockComponent2 {
			public static type = "Controllers";
			public name = "TestController2";
			public initialize(...args: any[]): void {
				expect(args[0]).toBe(42);
				expect(args[1]).toBe(NaN);
				init();
			}
			public static get relations(): null {
				return null;
			}
		}
		class App extends Application {
			public constructor() {
				super([MockComponent1, MockComponent2], { logging: false });
			}
			public async initialize(): Promise<void> {
				await super.initialize(
					[MockComponent1, "arg1", 2],
					[MockComponent2, 42, NaN]
				);
			}
		}

		const app = new App();
		await app.initialize();
		expect(init).toBeCalledTimes(2);
	});

	/**
	 * Test application throwing exceptions
	 */
	it("componentExceptions", async () => {
		console.log = jest.fn();
		console.error = jest.fn();
		console.warn = jest.fn();

		class MockComponent1 {
			public static type = "Controllers";
			public name = "Initter";
			public initialize(): void {
				throw new Error();
			}
			public close(): void {
				throw new Error();
			}
			public static get relations(): null {
				return null;
			}
		}
		class MockComponent2 {
			public static type = "Controllers";
			public name = "Constructor";
			public constructor() {
				throw new Error();
			}
			public static get relations(): null {
				return null;
			}
		}
		class App extends Application {
			public constructor() {
				super([MockComponent1, MockComponent2]);
			}
		}

		const app = new App();
		await app.initialize();
		expect(console.log).toBeCalled();
		expect(console.error).toBeCalledTimes(2);

		await app.close();
		expect(console.error).toBeCalledTimes(3);
		expect(console.warn).toBeCalledTimes(2);

		const getter = (): void => {
			app["getComponent"](jest.fn() as any);
		};

		expect(getter).toThrowError();
	});

	/**
	 * Test component refresh functionality
	 */
	it("componentsRefresh", async () => {
		class MockComponent1 {
			public static type = "Controllers";
			public name = "NonRelational";
			public constructor({ refresh }: IComponentOptions) {
				refresh();
			}
			public static get relations(): null {
				return null;
			}
		}

		const close = jest.fn();
		const obj1 = {};
		const obj2 = {};
		let relations = [obj1, obj2];

		class MockComponent2 {
			public static type = "Controllers";
			public name = "Relational";
			public constructor({ refresh }: IComponentOptions) {
				refresh();
			}
			public close(): void {
				close();
			}
			public static get relations(): object[] {
				return relations;
			}
		}

		class App extends Application {
			public constructor() {
				super([MockComponent1, MockComponent2], { logging: true });
			}
		}

		const app = new App();
		expect(app["components"].length).toBe(3);
		relations = [obj1];
		expect(app["components"].length).toBe(3);
		await app.initialize();
		await sleep(1);
		app.logging = false;

		expect(app["components"].length).toBe(2);
		expect(close).toBeCalledTimes(1);
		relations = [];
		app.refresh();
		await sleep(1);

		expect(app["components"].length).toBe(1);
		expect(close).toBeCalledTimes(2);

		app.logging = true;
		relations = [obj1, obj2];
		app.refresh();
		await sleep(1);
		expect(app["components"].length).toBe(3);

		expect(app["getComponents"](MockComponent2).length).toBe(2);
		expect(app["getComponent"](MockComponent2)).toBeInstanceOf(
			MockComponent2
		);
		expect(
			app["getComponents"](MockComponent2).every(
				x => x instanceof MockComponent2
			)
		);
	});

	/**
	 * Test components passed as promises
	 */
	it("promisedComponents", async () => {
		class MockComponent {
			public static type = "Service";
			public name = "Promise";
			public static get relations(): object[] {
				return [{}];
			}
		}
		const promised = new Proxy(MockComponent, {
			construct: (): any => {
				return new Promise(resolve => {
					resolve(new MockComponent());
				});
			}
		});

		class App extends Application {
			public constructor() {
				super([promised] as any);
			}
		}

		const app = new App();
		expect(app["components"][0]).toBeInstanceOf(Promise);
		expect(app["relations"].keys().next().value).toBeInstanceOf(Promise);
		await app.initialize();
		expect(app["components"][0]).toBeInstanceOf(MockComponent);
		expect(app["relations"].keys().next().value).toBeInstanceOf(
			MockComponent
		);
	});

	/**
	 * Test component handler
	 */
	it("componentHandlers", async () => {
		class MockComponent {
			public static type = "Controllers";
			public name = "Something";

			public state = "NotConstructed";

			public constructor() {
				this.state = "Constructed";
			}
			public initialize(): void {
				this.state = "Initialized";
			}
			public static get relations(): object[] {
				return [{}, {}];
			}
		}

		const handled = jest.fn();

		class App extends Application {
			public constructor() {
				super([MockComponent]);
			}

			public async initialize(): Promise<any> {
				return await super.initialize();
			}

			@handle(MockComponent)
			protected onMockComponent(self: MockComponent): void {
				expect(self).toBeInstanceOf(MockComponent);
				expect(self.state).toBe("Constructed");
				handled();
			}
		}

		const app = new App();
		await app.initialize();
		expect(app["handlers"].keys().next().value).toBe(MockComponent);
		expect(handled).toBeCalledTimes(2);
	});
});
