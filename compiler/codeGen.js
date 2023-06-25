import { Opcodes, Valtype } from "./wasmSpec.js";
import { signedLEB128, unsignedLEB128, encodeVector, encodeLocal } from "./encoding.js";
import { operatorOpcode } from "./expression.js";

const importedFuncs = { print: 0 };
const funcs = [];
const funcIndex = {};
let currentFuncIndex = 1;

const debug = str => {
  const code = [];

  const logChar = n => {
    code.push(Opcodes.i32_const, ...signedLEB128(n));

    code.push(Opcodes.call);
    code.push(...unsignedLEB128(0));
  };

  for (let i = 0; i < str.length; i++) {
    logChar(str.charCodeAt(i));
  }

  logChar('\n'.charCodeAt(0));

  return code;
};

const todo = msg => {
  throw new Error(`todo: ${msg}`);

  const code = [];

  code.push(...debug(`todo! ` + msg));
  code.push(Opcodes.unreachable);

  return code;
};

let lastCode;
const generate = (scope, decl) => {
  switch (decl.type) {
    case 'BinaryExpression':
      return lastCode = generateBinaryExp(scope, decl);

    case 'Identifier':
      return lastCode = generateIdent(scope, decl);

    case 'FunctionDeclaration':
      return lastCode = generateFunc(scope, decl);

    case 'BlockStatement':
      return lastCode = generateCode(scope, decl);

    case 'ReturnStatement':
      return lastCode = generateReturn(scope, decl);

    case 'ExpressionStatement':
      return lastCode = generateExp(scope, decl);

    case 'CallExpression':
      return lastCode = generateCall(scope, decl);

    case 'Literal':
      return lastCode = generateLiteral(scope, decl);

    case 'VariableDeclaration':
      return lastCode = generateVar(scope, decl);

    default:
      return todo(`no generation for ${decl.type}!`);
  }
};

const generateIdent = (scope, decl) => {
  let idx = scope.locals[decl.name];
  if (idx === undefined && importedFuncs[decl.name]) {
    return generateLiteral(importedFuncs[decl.name]);
  }

  if (idx === undefined && funcIndex[decl.name]) {
    return generateLiteral(funcIndex[decl.name]);
  }

  if (idx === undefined) throw new Error(`could not find local idx ${decl.name} (locals: ${Object.keys(scope.locals)})`);

  return [ Opcodes.local_get, idx ];
};

const generateReturn = (scope, decl) => {
  return [
    ...generate(scope, decl.argument),
    Opcodes.return
  ];
};

const generateBinaryExp = (scope, decl) => {
  // TODO: this assumes all variables are numbers !!!

  return [
    ...generate(scope, decl.left),
    ...generate(scope, decl.right),
    operatorOpcode[decl.operator]
  ];
};

const generateLiteral = (scope, decl) => {
  switch (typeof decl.value) {
    case 'number':
      return [ Opcodes.i32_const, ...signedLEB128(decl.value) ];

    default:
      return todo(`cannot generate literal of type ${typeof decl.value}`);
  }
};

const generateExp = (scope, decl) => {
  const expression = decl.expression;

  return generate(scope, expression);
};

const generateCall = (scope, decl) => {
  /* const callee = decl.callee;
  const args = decl.arguments;

  return [
    ...generate(args),
    ...generate(callee),
    Opcodes.call_indirect,
  ]; */

  // TODO: only allows callee as literal
  if (!decl.callee.name) return todo(`only literal callees`);

  const idx = funcIndex[decl.callee.name] ?? importedFuncs[decl.callee.name];
  if (idx === undefined) throw new Error(`failed to find func idx for ${decl.callee.name} (funcIndex: ${Object.keys(funcIndex)})`);

  const out = [];
  for (const arg of decl.arguments) {
    out.push(...generate(scope, arg));
  }

  out.push(Opcodes.call, idx);

  return out;
};

const generateVar = (scope, decl) => {
  const out = [];

  for (const x of decl.declarations) {
    const name = x.id.name;

    const idx = Object.keys(scope.locals).length;
    scope.locals[name] = idx;

    out.push(...generate(scope, x.init));
    out.push(Opcodes.local_set, idx);
  }

  return out;
};

const generateAssignPat = (scope, decl) => {
  // TODO
  // if identifier declared, use that
  // else, use default (right)
  return todo('assignment pattern (optional arg)');
};

const generateFunc = (scope, decl) => {
  const name = decl.id.name;
  const params = decl.params ?? [];

  // const innerScope = { ...scope };
  // TODO: share scope/locals between !!!
  const innerScope = { locals: {} };

  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    innerScope.locals[param.name] = i;
  }

  const func = {
    name,
    params,
    wasm: generate(innerScope, decl.body),
    index: currentFuncIndex++
  };

  const localCount = Object.keys(innerScope.locals).length - params.length;
  const localDecl = localCount > 0 ? [encodeLocal(localCount, Valtype.i32)] : [];
  func.wasm = encodeVector([ ...encodeVector(localDecl), ...func.wasm, Opcodes.end ]);

  funcs.push(func);
  funcIndex[name] = func.index;

  return [];
};

const generateCode = (scope, decl) => {
  const out = [];

  for (const x of decl.body) {
    out.push(...generate(scope, x));
  }

  return out;
};

export default program => {
  program.id = { name: 'main' };

  const scope = {
    locals: {}
  };

  program.body = {
    type: 'BlockStatement',
    body: program.body
  };

  generateFunc(scope, program);

  return funcs;
};