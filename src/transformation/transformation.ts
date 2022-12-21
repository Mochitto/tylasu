import {
    ASTNode,
    ensureNodeDefinition,
    getNodeDefinition,
    Node,
    NODE_DEFINITION_SYMBOL, Origin, Property,
    registerNodeDefinition,
    registerNodeProperty
} from "../model/model";
import {Issue, IssueSeverity} from "../validation";
import {Position} from "../model/position";

function isClassType(type) : boolean {
    return typeof type == 'function' &&
        type.name != undefined &&
        new RegExp(`[class\\s+${type.name}.*]`).test(type.toString());
}

function isSuperClass(subClass, superClass) : boolean {
    return isClassType(superClass) &&
        // eslint-disable-next-line no-prototype-builtins
        superClass.prototype.constructor.isPrototypeOf(subClass);
}

function getClassTypeName(type) : string | undefined {
    if (isClassType(type))
        return type.name;
    else return undefined;
}

export class NodeFactory<Source, Output extends Node> {
    constructor(
        public constructorFunction: (s: Source, t: ASTTransformer, f: NodeFactory<Source, Output>) => Output | undefined,
        public children: Map<string, ChildNodeFactory<Source, any, any> | undefined> = new Map(),
        public finalizer: (Output) => void = () => undefined
    ) {}

    // TODO: port other overrides of the withChild method?
    withChild = function<Target extends any, Child extends any>(
       get: (s: Source) => any | undefined,
       set: (t: Target, c?: Child) => void,
       name: string,
       type?: any
    ) : NodeFactory<Source, Output> {

        const prefix = isClassType(type) ? `${getClassTypeName(type)}#` : "";
        this.children.set(prefix + name, new ChildNodeFactory(prefix + name, get, set));
        return this;
    }

    withFinalizer = function (finalizer: (Output) => void) {
        this.finalizer = finalizer;
    }

    getter : (Source) => any = function(path: string) {
        return function(src: Source) {
            let sub = src;

            for (const elem in path.split(".")) {
                if (sub == null)
                    break;
                sub = this.getSubExpression(sub, elem);
            }

            return sub;
        }
    }

    private getSubExpression : any | undefined = function (src: any, elem: string) {
        if (Array.isArray(src)) {
            return src.map(it => this.getSubExpression(it!, elem));
        } else {
            const sourcePropName : string | undefined = Object.keys(src).find(e => e == elem);

            if (!sourcePropName)
                throw new Error(`${elem} not found in ${src} (class: ${Object.getPrototypeOf(src).constructor.name})`)

            const sourceProp = src[sourcePropName];
            return sourceProp instanceof Function ? sourceProp() : sourceProp;
        }
    }
}

export class ChildNodeFactory<Source, Target, Child> {
    constructor(
        public name: string,
        public get: (Source) => any | undefined,
        public setter: (Target, Child?) => void
    ) {}

    set = function(node: Target, child?: Child) {
        try {
            this.setter(node, child);
        } catch (e) {
            // TODO: pass e as the cause of this error
            throw Error(`${this.name} could not set child ${child} of ${node} using ${this.setter}`);
        }
    }
}

/**
 * Sentinel value used to represent the information that a given property is not a child node.
 */
const NO_CHILD_NODE = new ChildNodeFactory<any, any, any>(
    "",
    (node) => node,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    (target, child) => {}
);

/**
 * Implementation of a tree-to-tree transformation. For each source node type, we can register a factory that knows how
 * to create a transformed node. Then, this transformer can read metadata in the transformed node to recursively
 * transform and assign children.
 * If no factory is provided for a source node type, a GenericNode is created, and the processing of the subtree stops
 * there.
 */
export class ASTTransformer {
    private readonly _issues: Issue[];
    private readonly allowGenericNode: boolean;

    get issues() : Issue[] {
        return this._issues;
    }

    /**
     * Factories that map from source tree node to target tree node.
     */
    private factories = new Map<any, NodeFactory<any, any>>();

    /**
     * @param issues Additional issues found during the transformation process.
     * @param allowGenericNode Use GenericNode as a strategy for missing factories for nodes.
     */
    constructor(issues: Issue[] = [], allowGenericNode = true) {
        this._issues = issues;
        this.allowGenericNode = allowGenericNode;
    }

    addIssue(message: string, severity: IssueSeverity = IssueSeverity.ERROR, position?: Position) : Issue {
        const issue = Issue.semantic(message, severity, position);
        this._issues.push(issue);
        return issue;
    }

    transform(source?: any, parent?: Node) : Node | undefined {
        if (source == undefined)
            return undefined;

        if (Array.isArray(source))
            throw Error("Mapping error: received collection when value was expected");

        const factory: NodeFactory<any, any> | undefined = this.getNodeFactory(source);
        let node: Node | undefined;

        if (factory != undefined) {
            node = this.makeNode(factory, source);

            if (node == undefined)
                return undefined;

            Object.keys(node).forEach(propertyName => {
                const nodeClass = Object.getPrototypeOf(node).constructor;
                const prefix = isClassType(nodeClass) ? `${nodeClass.name}#` : "";
                const childKey: string = prefix + propertyName;
                const childNodeFactory = factory.children.get(childKey);
                if (childNodeFactory) {
                    if (childNodeFactory !== NO_CHILD_NODE) {
                        this.setChild(childNodeFactory, source, node!, propertyName);
                    }
                } else {
                    factory.children.set(childKey, NO_CHILD_NODE);
                }
            });

            factory.finalizer(node);
            node.parent = parent;
        }
        else {
            if (this.allowGenericNode) {
                const origin : Origin | undefined = this.asOrigin(source);
                node = new GenericNode(parent).withOrigin(origin);
                this._issues.push(
                    Issue.semantic(
                        `Source node not mapped: ${Object.getPrototypeOf(source).constructor.name}`,
                        IssueSeverity.INFO,
                        origin?.position
                    )
                );
            }
            else {
                throw new Error(`Unable to translate node ${source} (class ${Object.getPrototypeOf(source).constructor.name})`)
            }
        }

        return node;
    }

    asOrigin(source: any) : Origin | undefined {
        if (source instanceof Origin)
            return source;
        else
            return undefined;
    }

    setChild(
        childNodeFactory: ChildNodeFactory<any, any, any>,
        source: any,
        node: Node,
        propertyDescription: string
    ) : void {
        const src = childNodeFactory.get(this.getSource(node, source));

        let child: any | undefined;
        if (Array.isArray(src)) {
            child = src.map(it => this.transform(it, node)).filter(n => n != undefined);
        }
        else {
            child = this.transform(src, node);
        }

        try {
            childNodeFactory.set(node, child);
        } catch (e) {
            throw new Error(`Could not set child ${childNodeFactory}`);
        }
    }

    getSource(node: Node, source: any) : any {
        return source;
    }

    makeNode<S extends any, T extends Node>(
        factory: NodeFactory<S, T>,
        source: S,
        allowGenericNode = true
    ) : Node | undefined {

        let node : Node | undefined;

        try {
            node = factory.constructorFunction(source, this, factory);
        } catch (e) {
            if (allowGenericNode)
                node = new ErrorNode(e);
            else
                throw e;
        }

        if (node)
            node.withOrigin(this.asOrigin(source));

        return node;
    }

    getNodeFactory<S extends any, T extends Node>(type: any) : NodeFactory<S, T> | undefined {

        let nodeClass = type;

        if (!isClassType(type) && typeof type === 'object')
            nodeClass = Object.getPrototypeOf(type).constructor;

        while (nodeClass) {
            const factory : NodeFactory<S, T> | undefined = this.factories.get(nodeClass);
            if (factory)
                return factory as NodeFactory<S, T>;
            nodeClass = Object.getPrototypeOf(nodeClass);
        }

        return undefined;
    }

    public registerNodeFactory<S extends any, T extends Node>(
        nodeClass: any,
        factory: (type: S, transformer: ASTTransformer, factory: NodeFactory<S, T>) => T | undefined
    ) : NodeFactory<S, T> {

        if (!isClassType(nodeClass))
            throw Error(`${nodeClass} must be a class type`);

        const nodeFactory = new NodeFactory(factory);
        this.factories.set(nodeClass, nodeFactory);
        return nodeFactory;
    }

    public registerIdentityTransformation<T extends Node>(nodeClass: any) : NodeFactory<T, T> {
        if (!isSuperClass(nodeClass, Node))
            throw new Error(`${nodeClass} must be a subclass type of Node`);

        return this.registerNodeFactory(
            nodeClass,
            (node: T, t, f) => node
        );
    }
}



//-----------------------------------//
// Factory and metadata registration //
//-----------------------------------//

export const NODE_FACTORY_SYMBOL = Symbol("nodeFactory");
export const INIT_SYMBOL = Symbol("init");

//TODO for future version: allow multiple factories, keyed by name (string | symbol).
export function registerNodeFactory<T>(type: new (...args: any[]) => T, factory: (tree: T) => Node): void {
    type.prototype[NODE_FACTORY_SYMBOL] = factory;
}

/**
 * Marks a property of a node as mapped from a property of another node of a different name.
 * @param type the source node's type.
 * @param propertyName the name of the target property.
 * @param path the path in the source node that will be mapped to the target property.
 */
export function registerPropertyMapping<T extends Node>(
    type: new (...args: any[]) => T, propertyName: string, path: string = propertyName): any {
    const propInfo = registerNodeProperty(type, propertyName);
    propInfo.path = path || propertyName;
    return propInfo;
}

export function registerInitializer<T extends Node>(type: new (...args: any[]) => T, methodName: string): void {
    type[INIT_SYMBOL] = methodName;
}

//------------//
// Decorators //
//------------//

export function NodeTransform<T extends Node>(type: new (...args: any[]) => T) {
    return function (target: new () => Node): void {
        if(!target[NODE_DEFINITION_SYMBOL]) {
            registerNodeDefinition(target);
        }
        registerNodeFactory(type, () => new target());
    };
}

/**
 * Marks a property of a node as mapped from a property of another node of a different name.
 *
 * Note: this will eventually be integrated with Kolasu-style transformers.
 * @param path the path in the source node that will be mapped to the target property.
 */
export function Mapped(path?: string): (target, methodName: string) => void {
    return function (target, methodName: string) {
        registerPropertyMapping(target, methodName, path);
    };
}

/**
 * Decorator to register an initializer method on a Node. When a node is instantiated as the target of a
 * transformation, after its properties have been set, the transformer calls the init method, if any.
 * @param target the target type.
 * @param methodName the name of the init method.
 * @deprecated this will be replaced by Kolasu-style transformers.
 */
// Since target is any-typed (see https://www.typescriptlang.org/docs/handbook/decorators.html),
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function Init(target, methodName: string): void {
    registerInitializer(target, methodName);
}

//-----------------//
// Transformations //
//-----------------//

export function fillChildAST<FROM, TO extends Node>(
    node: TO, property: string, tree: FROM | undefined, transformer: (node: FROM) => TO | undefined): TO[] {
    const propDef = ensureNodeDefinition(node).properties[property];
    const propertyPath = propDef.path || property;
    if (propertyPath && propertyPath.length > 0) {
        const path = propertyPath.split(".");
        let error;
        for (const segment in path) {
            if (tree && (typeof(tree[path[segment]]) === "function")) {
                try {
                    tree = tree[path[segment]]();
                } catch (e) {
                    error = e;
                    break;
                }
            } else if (tree && tree[path[segment]]) {
                tree = tree[path[segment]];
            } else {
                tree = undefined;
                break;
            }
        }
        if(error) {
            node[property] = new ErrorNode(error);
        } else if (tree) {
            if(propDef.child) {
                if (Array.isArray(tree)) {
                    node[property] = [];
                    for (const i in tree) {
                        node[property].push(transformer(tree[i])?.withParent(node));
                    }
                    return node[property];
                } else {
                    node[property] = transformer(tree)?.withParent(node);
                    return [node[property]];
                }
            } else {
                node[property] = tree;
            }
        }
    }
    return [];
}

function makeNode(factory, tree: unknown) {
    try {
        return factory(tree) as Node;
    } catch (e) {
        return new ErrorNode(e);
    }
}

export function transform(tree: unknown, parent?: Node, transformer: typeof transform = transform): Node | undefined {
    if (typeof tree !== "object" || !tree) {
        return undefined;
    }
    const factory = tree[NODE_FACTORY_SYMBOL];
    let node: Node;
    if (factory) {
        node = makeNode(factory, tree);
        const def = getNodeDefinition(node);
        if (def) {
            for (const p in def.properties) {
                fillChildAST(node, p, tree, transformer);
            }
        }
        const initFunction = node[INIT_SYMBOL];
        if (initFunction) {
            try {
                node[initFunction].call(node, tree);
            } catch (e) {
                node = new PartiallyInitializedNode(node, e);
            }
        }
    } else {
        node = new GenericNode();
    }
    return node.withParent(parent);
}

@ASTNode("", "GenericNode")
export class GenericNode extends Node {
    constructor(parent?: Node) {
        super();
        this.parent = parent;
    }
}

@ASTNode("", "ErrorNode")
export class ErrorNode extends Node {
    constructor(readonly error: Error) {
        super();
    }
}

export class PartiallyInitializedNode extends ErrorNode {
    constructor(readonly node: Node, error: Error) {
        super(error);
    }
}
