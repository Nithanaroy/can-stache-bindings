/*can-stache-bindings@4.0.0-pre.1#can-stache-bindings*/
var expression = require('can-stache/src/expression');
var viewCallbacks = require('can-view-callbacks');
var live = require('can-view-live');
var Scope = require('can-view-scope');
var canViewModel = require('can-view-model');
var canEvent = require('can-event');
var canBatch = require('can-event/batch/batch');
var compute = require('can-compute');
var observeReader = require('can-observation/reader/reader');
var Observation = require('can-observation');
var assign = require('can-util/js/assign/assign');
var makeArray = require('can-util/js/make-array/make-array');
var each = require('can-util/js/each/each');
var string = require('can-util/js/string/string');
var dev = require('can-util/js/dev/dev');
var types = require('can-types');
var getMutationObserver = require('can-util/dom/mutation-observer/mutation-observer');
var domEvents = require('can-util/dom/events/events');
require('can-util/dom/events/removed/removed');
var domData = require('can-util/dom/data/data');
var attr = require('can-util/dom/attr/attr');
var behaviors = {
    viewModel: function (el, tagData, makeViewModel, initialViewModelData) {
        initialViewModelData = initialViewModelData || {};
        var bindingsSemaphore = {}, viewModel, onCompleteBindings = [], onTeardowns = {}, bindingInfos = {}, attributeViewModelBindings = assign({}, initialViewModelData);
        each(makeArray(el.attributes), function (node) {
            var dataBinding = makeDataBinding(node, el, {
                templateType: tagData.templateType,
                scope: tagData.scope,
                semaphore: bindingsSemaphore,
                getViewModel: function () {
                    return viewModel;
                },
                attributeViewModelBindings: attributeViewModelBindings,
                alreadyUpdatedChild: true,
                nodeList: tagData.parentNodeList
            });
            if (dataBinding) {
                if (dataBinding.onCompleteBinding) {
                    if (dataBinding.bindingInfo.parentToChild && dataBinding.value !== undefined) {
                        initialViewModelData[cleanVMName(dataBinding.bindingInfo.childName)] = dataBinding.value;
                    }
                    onCompleteBindings.push(dataBinding.onCompleteBinding);
                }
                onTeardowns[node.name] = dataBinding.onTeardown;
            }
        });
        viewModel = makeViewModel(initialViewModelData);
        for (var i = 0, len = onCompleteBindings.length; i < len; i++) {
            onCompleteBindings[i]();
        }
        domEvents.addEventListener.call(el, 'attributes', function (ev) {
            var attrName = ev.attributeName, value = el.getAttribute(attrName);
            if (onTeardowns[attrName]) {
                onTeardowns[attrName]();
            }
            var parentBindingWasAttribute = bindingInfos[attrName] && bindingInfos[attrName].parent === 'attribute';
            if (value !== null || parentBindingWasAttribute) {
                var dataBinding = makeDataBinding({
                    name: attrName,
                    value: value
                }, el, {
                    templateType: tagData.templateType,
                    scope: tagData.scope,
                    semaphore: {},
                    getViewModel: function () {
                        return viewModel;
                    },
                    attributeViewModelBindings: attributeViewModelBindings,
                    initializeValues: true,
                    nodeList: tagData.parentNodeList
                });
                if (dataBinding) {
                    if (dataBinding.onCompleteBinding) {
                        dataBinding.onCompleteBinding();
                    }
                    bindingInfos[attrName] = dataBinding.bindingInfo;
                    onTeardowns[attrName] = dataBinding.onTeardown;
                }
            }
        });
        return function () {
            for (var attrName in onTeardowns) {
                onTeardowns[attrName]();
            }
        };
    },
    data: function (el, attrData) {
        if (domData.get.call(el, 'preventDataBindings')) {
            return;
        }
        var viewModel = canViewModel(el), semaphore = {}, teardown;
        var dataBinding = makeDataBinding({
            name: attrData.attributeName,
            value: el.getAttribute(attrData.attributeName),
            nodeList: attrData.nodeList
        }, el, {
            templateType: attrData.templateType,
            scope: attrData.scope,
            semaphore: semaphore,
            getViewModel: function () {
                return viewModel;
            }
        });
        if (dataBinding.onCompleteBinding) {
            dataBinding.onCompleteBinding();
        }
        teardown = dataBinding.onTeardown;
        canEvent.one.call(el, 'removed', function () {
            teardown();
        });
        domEvents.addEventListener.call(el, 'attributes', function (ev) {
            var attrName = ev.attributeName, value = el.getAttribute(attrName);
            if (attrName === attrData.attributeName) {
                if (teardown) {
                    teardown();
                }
                if (value !== null) {
                    var dataBinding = makeDataBinding({
                        name: attrName,
                        value: value
                    }, el, {
                        templateType: attrData.templateType,
                        scope: attrData.scope,
                        semaphore: semaphore,
                        getViewModel: function () {
                            return viewModel;
                        },
                        initializeValues: true,
                        nodeList: attrData.nodeList
                    });
                    if (dataBinding) {
                        if (dataBinding.onCompleteBinding) {
                            dataBinding.onCompleteBinding();
                        }
                        teardown = dataBinding.onTeardown;
                    }
                }
            }
        });
    },
    reference: function (el, attrData) {
        if (el.getAttribute(attrData.attributeName)) {
            console.warn('*reference attributes can only export the view model.');
        }
        var name = string.camelize(attrData.attributeName.substr(1).toLowerCase());
        var viewModel = canViewModel(el);
        var refs = attrData.scope.getRefs();
        refs._context.attr('*' + name, viewModel);
    },
    event: function (el, data) {
        var attributeName = data.attributeName, event = removeBrackets(attributeName, '(', ')'), onBindElement;
        if (event.charAt(0) === '$') {
            event = event.substr(1);
            onBindElement = true;
        }
        var handler = function (ev) {
            var attrVal = el.getAttribute(attributeName);
            if (!attrVal) {
                return;
            }
            var viewModel = canViewModel(el);
            var expr = expression.parse(removeBrackets(attrVal), {
                lookupRule: 'method',
                methodRule: 'call'
            });
            if (!(expr instanceof expression.Call) && !(expr instanceof expression.Helper)) {
                var defaultArgs = [
                    data.scope._context,
                    el
                ].concat(makeArray(arguments)).map(function (data) {
                    return new expression.Arg(new expression.Literal(data));
                });
                expr = new expression.Call(expr, defaultArgs, {});
            }
            var localScope = data.scope.add({
                '%element': this,
                '$element': types.wrapElement(el),
                '%event': ev,
                '%viewModel': viewModel,
                '%scope': data.scope,
                '%context': data.scope._context,
                '%arguments': arguments
            }, { notContext: true });
            var scopeData = localScope.read(expr.methodExpr.key, { isArgument: true });
            if (!scopeData.value) {
                scopeData = localScope.read(expr.methodExpr.key, { isArgument: true });
                return null;
            }
            var args = expr.args(localScope, null)();
            return scopeData.value.apply(scopeData.parent, args);
        };
        if (special[event]) {
            var specialData = special[event](data, el, handler);
            handler = specialData.handler;
            event = specialData.event;
        }
        canEvent.on.call(onBindElement ? el : canViewModel(el), event, handler);
        var attributesHandler = function (ev) {
            if (ev.attributeName === attributeName && !this.getAttribute(attributeName)) {
                canEvent.off.call(onBindElement ? el : canViewModel(el), event, handler);
                canEvent.off.call(el, 'attributes', attributesHandler);
            }
        };
        canEvent.on.call(el, 'attributes', attributesHandler);
    }
};
viewCallbacks.attr(/^\{[^\}]+\}$/, behaviors.data);
viewCallbacks.attr(/\*[\w\.\-_]+/, behaviors.reference);
viewCallbacks.attr(/^\([\$?\w\.]+\)$/, behaviors.event);
var getComputeFrom = {
    scope: function (el, scope, scopeProp, bindingData, mustBeACompute, stickyCompute) {
        if (!scopeProp) {
            return compute();
        } else {
            if (mustBeACompute) {
                var parentExpression = expression.parse(scopeProp, { baseMethodType: 'Call' });
                return parentExpression.value(scope, new Scope.Options({}));
            } else {
                return function (newVal) {
                    scope.attr(cleanVMName(scopeProp), newVal);
                };
            }
        }
    },
    viewModel: function (el, scope, vmName, bindingData, mustBeACompute, stickyCompute) {
        var setName = cleanVMName(vmName);
        if (mustBeACompute) {
            return compute(function (newVal) {
                var viewModel = bindingData.getViewModel();
                if (arguments.length) {
                    if (types.isMapLike(viewModel)) {
                        observeReader.set(viewModel, setName, newVal);
                    } else {
                        viewModel[setName] = newVal;
                    }
                } else {
                    return vmName === '.' ? viewModel : observeReader.read(viewModel, observeReader.reads(vmName), {}).value;
                }
            });
        } else {
            return function (newVal) {
                var childCompute;
                var viewModel = bindingData.getViewModel();
                function updateViewModel(value, options) {
                    if (types.isMapLike(viewModel)) {
                        observeReader.set(viewModel, setName, value, options);
                    } else {
                        viewModel[setName] = value;
                    }
                }
                if (stickyCompute) {
                    childCompute = observeReader.get(viewModel, setName, { readCompute: false });
                    if (!childCompute || !childCompute.isComputed) {
                        childCompute = compute();
                        updateViewModel(childCompute, { readCompute: false });
                    }
                    childCompute(newVal);
                } else {
                    updateViewModel(newVal);
                }
            };
        }
    },
    attribute: function (el, scope, prop, bindingData, mustBeACompute, stickyCompute, event) {
        if (!event) {
            if (attr.special[prop] && attr.special[prop].addEventListener) {
                event = prop;
            } else {
                event = 'change';
            }
        }
        var hasChildren = el.nodeName.toLowerCase() === 'select', isMultiselectValue = prop === 'value' && hasChildren && el.multiple, set = function (newVal) {
                attr.setAttrOrProp(el, prop, newVal);
                return newVal;
            }, get = function () {
                return attr.get(el, prop);
            };
        if (isMultiselectValue) {
            prop = 'values';
        }
        return compute(get(), {
            on: function (updater) {
                canEvent.on.call(el, event, updater);
            },
            off: function (updater) {
                canEvent.off.call(el, event, updater);
            },
            get: get,
            set: set
        });
    }
};
var bind = {
    childToParent: function (el, parentCompute, childCompute, bindingsSemaphore, attrName, syncChild) {
        var parentUpdateIsFunction = typeof parentCompute === 'function';
        var updateParent = function (ev, newVal) {
            if (!bindingsSemaphore[attrName]) {
                if (parentUpdateIsFunction) {
                    parentCompute(newVal);
                    if (syncChild) {
                        if (parentCompute() !== childCompute()) {
                            bindingsSemaphore[attrName] = (bindingsSemaphore[attrName] || 0) + 1;
                            childCompute(parentCompute());
                            Observation.afterUpdateAndNotify(function () {
                                --bindingsSemaphore[attrName];
                            });
                        }
                    }
                } else if (types.isMapLike(parentCompute)) {
                    parentCompute.attr(newVal, true);
                }
            }
        };
        if (childCompute && childCompute.isComputed) {
            childCompute.bind('change', updateParent);
        }
        return updateParent;
    },
    parentToChild: function (el, parentCompute, childUpdate, bindingsSemaphore, attrName) {
        var updateChild = function (ev, newValue) {
            bindingsSemaphore[attrName] = (bindingsSemaphore[attrName] || 0) + 1;
            canBatch.start();
            childUpdate(newValue);
            Observation.afterUpdateAndNotify(function () {
                --bindingsSemaphore[attrName];
            });
            canBatch.stop();
        };
        if (parentCompute && parentCompute.isComputed) {
            parentCompute.bind('change', updateChild);
        }
        return updateChild;
    }
};
var getBindingInfo = function (node, attributeViewModelBindings, templateType, tagName) {
    var bindingInfo, attributeName = node.name, attributeValue = node.value || '';
    var matches = attributeName.match(bindingsRegExp);
    if (!matches) {
        return;
    }
    var twoWay = !!matches[1], childToParent = twoWay || !!matches[2], parentToChild = twoWay || !childToParent;
    var childName = matches[3];
    var isDOM = childName.charAt(0) === '$';
    if (isDOM) {
        bindingInfo = {
            parent: 'scope',
            child: 'attribute',
            childToParent: childToParent,
            parentToChild: parentToChild,
            bindingAttributeName: attributeName,
            childName: childName.substr(1),
            parentName: attributeValue,
            initializeValues: true,
            syncChildWithParent: twoWay
        };
        if (tagName === 'select') {
            bindingInfo.stickyParentToChild = true;
        }
        return bindingInfo;
    } else {
        bindingInfo = {
            parent: 'scope',
            child: 'viewModel',
            childToParent: childToParent,
            parentToChild: parentToChild,
            bindingAttributeName: attributeName,
            childName: string.camelize(childName),
            parentName: attributeValue,
            initializeValues: true,
            syncChildWithParent: twoWay
        };
        if (attributeValue.trim().charAt(0) === '~') {
            bindingInfo.stickyParentToChild = true;
        }
        return bindingInfo;
    }
};
var bindingsRegExp = /\{(\()?(\^)?([^\}\)]+)\)?\}/;
var makeDataBinding = function (node, el, bindingData) {
    var bindingInfo = getBindingInfo(node, bindingData.attributeViewModelBindings, bindingData.templateType, el.nodeName.toLowerCase());
    if (!bindingInfo) {
        return;
    }
    bindingInfo.alreadyUpdatedChild = bindingData.alreadyUpdatedChild;
    if (bindingData.initializeValues) {
        bindingInfo.initializeValues = true;
    }
    var parentCompute = getComputeFrom[bindingInfo.parent](el, bindingData.scope, bindingInfo.parentName, bindingData, bindingInfo.parentToChild), childCompute = getComputeFrom[bindingInfo.child](el, bindingData.scope, bindingInfo.childName, bindingData, bindingInfo.childToParent, bindingInfo.stickyParentToChild && parentCompute), updateParent, updateChild, childLifecycle;
    if (bindingData.nodeList) {
        if (parentCompute && parentCompute.isComputed) {
            parentCompute.computeInstance.setPrimaryDepth(bindingData.nodeList.nesting + 1);
        }
        if (childCompute && childCompute.isComputed) {
            childCompute.computeInstance.setPrimaryDepth(bindingData.nodeList.nesting + 1);
        }
    }
    if (bindingInfo.parentToChild) {
        updateChild = bind.parentToChild(el, parentCompute, childCompute, bindingData.semaphore, bindingInfo.bindingAttributeName);
    }
    var completeBinding = function () {
        if (bindingInfo.childToParent) {
            updateParent = bind.childToParent(el, parentCompute, childCompute, bindingData.semaphore, bindingInfo.bindingAttributeName, bindingInfo.syncChildWithParent);
        } else if (bindingInfo.stickyParentToChild) {
            childCompute.bind('change', childLifecycle = function () {
            });
        }
        if (bindingInfo.initializeValues) {
            initializeValues(bindingInfo, childCompute, parentCompute, updateChild, updateParent);
        }
    };
    var onTeardown = function () {
        unbindUpdate(parentCompute, updateChild);
        unbindUpdate(childCompute, updateParent);
        unbindUpdate(childCompute, childLifecycle);
    };
    if (bindingInfo.child === 'viewModel') {
        return {
            value: bindingInfo.stickyParentToChild ? compute(getValue(parentCompute)) : getValue(parentCompute),
            onCompleteBinding: completeBinding,
            bindingInfo: bindingInfo,
            onTeardown: onTeardown
        };
    } else {
        completeBinding();
        return {
            bindingInfo: bindingInfo,
            onTeardown: onTeardown
        };
    }
};
var initializeValues = function (bindingInfo, childCompute, parentCompute, updateChild, updateParent) {
    var doUpdateParent = false;
    if (bindingInfo.parentToChild && !bindingInfo.childToParent) {
    } else if (!bindingInfo.parentToChild && bindingInfo.childToParent) {
        doUpdateParent = true;
    } else if (getValue(childCompute) === undefined) {
    } else if (getValue(parentCompute) === undefined) {
        doUpdateParent = true;
    }
    if (doUpdateParent) {
        updateParent({}, getValue(childCompute));
    } else {
        if (!bindingInfo.alreadyUpdatedChild) {
            updateChild({}, getValue(parentCompute));
        }
    }
};
if (!getMutationObserver()) {
    var updateSelectValue = function (el) {
        var bindingCallback = domData.get.call(el, 'canBindingCallback');
        if (bindingCallback) {
            bindingCallback.onMutation(el);
        }
    };
    live.registerChildMutationCallback('select', updateSelectValue);
    live.registerChildMutationCallback('optgroup', function (el) {
        updateSelectValue(el.parentNode);
    });
}
var removeBrackets = function (value, open, close) {
        open = open || '{';
        close = close || '}';
        if (value[0] === open && value[value.length - 1] === close) {
            return value.substr(1, value.length - 2);
        }
        return value;
    }, getValue = function (value) {
        return value && value.isComputed ? value() : value;
    }, unbindUpdate = function (compute, updateOther) {
        if (compute && compute.isComputed && typeof updateOther === 'function') {
            compute.unbind('change', updateOther);
        }
    }, cleanVMName = function (name) {
        return name.replace(/@/g, '');
    };
var special = {
    enter: function (data, el, original) {
        return {
            event: 'keyup',
            handler: function (ev) {
                if (ev.keyCode === 13 || ev.key === 'Enter') {
                    return original.call(this, ev);
                }
            }
        };
    }
};
module.exports = {
    behaviors: behaviors,
    getBindingInfo: getBindingInfo,
    special: special
};