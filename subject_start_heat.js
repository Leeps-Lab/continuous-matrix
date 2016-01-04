Redwood.controller("SubjectCtrl", ["$rootScope", "$scope", "RedwoodSubject", 'SynchronizedStopWatch', function($rootScope, $scope, rs, SynchronizedStopWatch) {

    var CLOCK_FREQUENCY = 30;
    $scope.activeFrame = '/static/experiments/continuousMatrix/continuousMatrixStart.html';

    rs.on_load(function() { //called once the page has loaded for a new sub period

        rs.config.pairs.forEach(function(pair, index) { //decide who is the first player and who is the second player
            var userIndex = pair.indexOf(parseInt(rs.user_id));
            if (userIndex > -1) {
                $scope.pair_index = index;
                $scope.user_index = userIndex;
                $scope.partner_id = pair[($scope.user_index + 1) % 2].toString();
            }
        });

        $scope.matrix = $scope.user_index === 0 ? rs.config.matrix : transpose(rs.config.matrix);
        
        console.log("matrix: ");
        console.log($scope.matrix);
        
        $scope.yMax = $scope.matrix[0][0][0]; //Find the maximum reward value to set the y-axis on the plot
        $scope.matrix.forEach(function(row) {
            row.forEach(function(cell) {
                cell.forEach(function(value) {
                    $scope.yMax = Math.max($scope.yMax, value);
                })
            })
        });

        $scope.clock = SynchronizedStopWatch.instance()
            .frequency(CLOCK_FREQUENCY).onTick(processTick)
            .duration(rs.config.period_length_s).onComplete(function() {
                rs.trigger("simulation_complete");
            });

        var numSubPeriods = rs.config.num_sub_periods || (rs.config.period_length_s * CLOCK_FREQUENCY); //If this config value is zero there will be a subperiod every tick
        $scope.ticksPerSubPeriod = Math.max(Math.floor(rs.config.period_length_s * CLOCK_FREQUENCY / numSubPeriods), 1);

        /*
         * Sets up the game type to dynamically change ng-include to the proper source for the heatmap
         */
        $scope.gameType = rs.config.gameType;
        $scope.showMatrix = false;
        $scope.showHeat = false;

        $scope.showoppheat = rs.config.show_opp_heat ? true : false;

        if ($scope.gameType == "matrix") $scope.showMatrix = true;
        else if ($scope.gameType == "heatmap") {
            $scope.showHeat = true;
            //enable slider also
            $("#slider").slider({
                value: $scope.matrix[0][0][0],
                min: $scope.matrix[0][0][0],
                max: $scope.matrix[0][0][1],
                step: 1,
                disabled: true
            });
        }
        $scope.rewards = [];
        $scope.opponentRewards = [];

        $scope.readyEnabled = true;
    });
  
    $scope.ready = function() {
        $scope.readyEnabled = false;
        rs.trigger("ready");
    };

    $scope.$on("slider.changed", function(e, val) {
        rs.trigger("heatAction", val);
        rs.send("heatAction", val);
    });

    rs.on("ready", function() { //event handler for ready button click
        $("#slider").slider({disabled:false});
        $scope.readyEnabled = false;
        rs.synchronizationBarrier('ready').then(function() {

            if (rs.config.initial_delay_s > 0) {
                $scope.tEnableInput = rs.config.initial_delay_s * CLOCK_FREQUENCY; //only enable input after the initial delay period specified in the config
            } else {
                $scope.actionsEnabled = true; //otherwise enable input immediately
            }

            $scope.action = rs.config.initial_actions[rs.user_id - 1]; //set actions to the initial actions specified in the config
            $scope.partnerAction = rs.config.initial_actions[$scope.partner_id - 1];
            $scope.prevPartnerAction = $scope.partnerAction;

            $scope.clock.start();
        });
    });

    var processTick = function(tick) {

        $scope.tick = tick;

        if (tick % $scope.ticksPerSubPeriod === 0) { //if this is the end of a sub period (in the "continuous" version, every tick is the end of a sub period)
            if ($scope.gameType == "matrix") {

                var reward = $scope.matrix[$scope.action - 1][$scope.partnerAction - 1][0]; //allocate reward based on the current user actions and the matrix
                var opponentReward = $scope.matrix[$scope.action - 1][$scope.partnerAction - 1][1];

            } else if ($scope.gameType == "heatmap") {

                var reward = payoff($scope.myHeatAction, $scope.partnerHeatAction);

                var opponentReward = oppPayoff($scope.myHeatAction, $scope.partnerHeatAction);

            }

            $scope.rewards.push(reward);
            rs.add_points(reward * $scope.ticksPerSubPeriod / $scope.clock.getDurationInTicks());

            $scope.opponentRewards.push(opponentReward);
            $scope.prevPartnerAction = $scope.partnerAction;
        }

        if ($scope.tEnableInput) {
            $scope.inputCountdown = Math.ceil(($scope.tEnableInput - $scope.tick) / CLOCK_FREQUENCY);
            if (tick >= $scope.tEnableInput) {
                $scope.actionsEnabled = true;
                $scope.tEnableInput = 0;
            }
        }

    };

    var payoff = function(x, y) {
        var first   =   $scope.matrix[0][0][0];
        var second  =   $scope.matrix[0][1][0];
        var third   =   $scope.matrix[1][0][0];
        var fourth  =   $scope.matrix[1][1][0];

        return (first*(x*y) + second*x*(1-y) + third*(1-x)*y + fourth*(1-x)*(1-y));
    }
    var oppPayoff = function(x, y) {
        var first   =   $scope.matrix[0][0][1];
        var second  =   $scope.matrix[0][1][1];
        var third   =   $scope.matrix[1][0][1];
        var fourth  =   $scope.matrix[1][1][1];

        return (first*(x*y) + second*x*(1-y) + third*(1-x)*y + fourth*(1-x)*(1-y));
    }

    $scope.onAction = function(action) {
        if (action !== $scope.action) { //only trigger action events when selection has actually changed
            $scope.action = action;
            rs.trigger("action", action);
        }
    };


    rs.on("action", function(value) { //triggered when the user changes their selection
        $scope.action = value;
        if (rs.config.action_cost > 0) { //subtract the action cost specified in the config
            rs.add_points(-rs.config.action_cost);
        }
        if (rs.config.action_delay_s > 0) { //disable inputs for the action delay specified in the config
            $scope.tEnableInput = $scope.tick + (rs.config.action_delay_s * CLOCK_FREQUENCY);
            $scope.actionsEnabled = false;
        }
    });

    rs.recv("action", function(sender, value) { //receive other subjects actions
        if (sender === $scope.partner_id) { //if the other subject is the opponent, update their current action
            $scope.partnerAction = value;
        }
    });

    rs.on("heatAction", function(val) {
        $scope.myHeatAction = val.value;
        if (rs.config.action_cost > 0) {
            rs.add_points(-rs.config.action_cost);
        }
        if (rs.config.action_delay_s > 0) {
            //heatmap.disable
        }
        $scope.myHeatAction = val.value;
        $scope.myScalar = val.value;
    });

    rs.recv("heatAction", function(sender, val) {
        if (sender == $scope.partner_id) {
            $scope.partnerHeatAction = val.value;
            $scope.partnerScalar = val.value
        }

    });

    rs.on("simulation_complete", function(value) {
        $scope.actionsEnabled = false;
        rs.next_period(5); //request the framework to advance to the next period
    });

    var transpose = function(matrix) { //transpose a 2x2 matrix
        var transposed = [
            [
                [],
                []
            ],
            [
                [],
                []
            ]
        ];
        for (var i = 0; i < 4; i++) {
            var row = Math.floor(i / 2);
            var column = i % 2;
            transposed[column][row] = [matrix[row][column][1], matrix[row][column][0]];
        }
        return transposed;
    };

}]);

Redwood.directive('plot', ['RedwoodSubject', function(rs) {
    return {
        link: function($scope, elem, attr) {

            var plot = [],
                opponentPlot = [],
                subPeriods = [],
                loaded = false;

            init();

            function init() {
                if ($scope.ticksPerSubPeriod > 1) {
                    var subPeriod = 0;
                    do {
                        subPeriod += $scope.ticksPerSubPeriod;
                        subPeriods.push(subPeriod / $scope.clock.getDurationInTicks());
                    } while (subPeriod < $scope.clock.getDurationInTicks());
                }
                loaded = true;
                replot();
            }

            $scope.$watch('tick', function(tick) {
                if (tick % $scope.ticksPerSubPeriod === 0) {
                    plot.push([($scope.tick - $scope.ticksPerSubPeriod) / $scope.clock.getDurationInTicks(), $scope.rewards[$scope.rewards.length - 1]]);
                    plot.push([$scope.tick / $scope.clock.getDurationInTicks(), $scope.rewards[$scope.rewards.length - 1]]);

                    opponentPlot.push([($scope.tick - $scope.ticksPerSubPeriod) / $scope.clock.getDurationInTicks(), $scope.opponentRewards[$scope.opponentRewards.length - 1]]);
                    opponentPlot.push([$scope.tick / $scope.clock.getDurationInTicks(), $scope.opponentRewards[$scope.opponentRewards.length - 1]]);
                    replot();
                }
                replot();
            }, true);

            function replot() {


                if (!loaded) return;

                var xRange = 1;
                var opts = {
                    xaxis: {
                        ticks: 0,
                        tickLength: 0,
                        min: 0,
                        max: xRange
                    },
                    yaxis: {
                        tickLength: 0,
                        min: 0,
                        max: $scope.yMax
                    },
                    series: {
                        shadowSize: 0
                    }
                };
                var dataset = [];
                for (var p = 0; p < subPeriods.length; p++) { //mark each sub-period with a vertical red line
                    dataset.push({
                        data: [
                            [subPeriods[p], opts.yaxis.min],
                            [subPeriods[p], opts.yaxis.max]
                        ],
                        lines: {
                            lineWidth: 1
                        },
                        color: "red"
                    });
                }
                dataset.push({ //plot your rewards as a grey integral
                    data: plot,
                    lines: {
                        fill: true,
                        lineWidth: 0,
                        fillColor: "#468847"
                    },
                    color: "grey"
                });
                dataset.push({ //plot your opponent's rewards as a black line
                    data: opponentPlot,
                    lines: {
                        lineWidth: 2
                    },
                    color: "black"
                });

                dataset.push({ //display the current time indicator as a vertical grey line
                    data: [
                        [$scope.tick / $scope.clock.getDurationInTicks(), opts.yaxis.min],
                        [$scope.tick / $scope.clock.getDurationInTicks(), opts.yaxis.max]
                    ],
                    color: "grey"
                });

                $.plot(elem, dataset, opts);
            }
        }
    }
}]);


Redwood.directive('heat', ['RedwoodSubject', function(rs) {
    return {

        link: function($scope, elem, attr) {

            var loaded = false;
            var width = 300;
            var height = 300;
            var canvas, ctx;
            init();

            function init() {
                loaded = true;

                initSlider();
                initLegend();
                redraw();
                if ($scope.showoppheat) 
                    drawOppHeat();
            }


            function initLegend() {
                
                
                var ctx = $("#heatLegend").loadCanvas();
                var width = ctx.canvas.width;
                var height = ctx.canvas.height;

                var values = undefined;
                var range = [undefined, undefined];
                var heatmap = undefined;

                if (heatmap == undefined) {
                    heatmap = ctx.createImageData(width, height);
                    values = [];
                    for (var y = 0; y < height; y++) {
                        for (var x = 0; x < width; x++) {
                            var value = heat(200 / width, y / height);
                            if (range[0] == undefined || value < range[0]) {
                                range[0] = value;
                            }
                            if (range[1] == undefined || value > range[1]) {
                                range[1] = value;
                            }
                            values.push(value);
                        }
                    }
                    for (var y = 0; y < height; y++) {
                        for (var x = 0; x < width; x++) {
                            var index = (y * width + x) * 4;
                            var color = heat_color(values[index / 4], range);
                            heatmap.data[index] = color[0];
                            heatmap.data[++index] = color[1];
                            heatmap.data[++index] = color[2];
                            heatmap.data[++index] = color[3];
                        }
                    }
                }
                ctx.putImageData(heatmap, 0, 0);
            }

            function drawOppHeat() {
                range = [undefined, undefined];
                heatmap = undefined;
                values = undefined;

                var ctx = $("#oppHeat").loadCanvas();
                var width = ctx.canvas.width;
                var height = ctx.canvas.height;
                if (heatmap == undefined) {
                    heatmap = ctx.createImageData(width, height);
                    values = [];
                    for (var y = 0; y < height; y++) {
                        for (var x = 0; x < width; x++) {
                            var value = oppHeat(x / width, y / height);
                            if (range[0] == undefined || value < range[0]) {
                                range[0] = value;
                            }
                            if (range[1] == undefined || value > range[1]) {
                                range[1] = value;
                            }
                            values.push(value);
                        }
                    }
                    for (var y = 0; y < height; y++) {
                        for (var x = 0; x < width; x++) {
                            var index = (y * width + x) * 4;
                            var color = heat_color(values[index / 4], range);
                            heatmap.data[index] = color[0];
                            heatmap.data[++index] = color[1];
                            heatmap.data[++index] = color[2];
                            heatmap.data[++index] = color[3];
                        }
                    }

                }

                var x = ($scope.partnerScalar * width); 
                var y = ((1-$scope.myScalar) * height);
                console.debug("filling in point at: " + x + "," + y + "." + "with myScalar = " + $scope.myScalar + " and partnerScalar= " + $scope.partnerScalar);
                ctx.putImageData(heatmap, 0, 0);



                //draw a circle
                ctx.beginPath();
                ctx.rect(x-5, y-5, 10, 10)
                ctx.closePath();
                ctx.fill();

               


            }

            function debounce(fn, delay) {
              var timer = null;
              return function () {
                var context = this, args = arguments;
                clearTimeout(timer);
                timer = setTimeout(function () {
                  fn.apply(context, args);
                }, delay);
              };
            }
            function initSlider() {
                console.log($scope.matrix);
                
                $("#slider").slider({
                    value: 0.5,
                    min: 0,
                    max: 1,
                    step: 0.01,
                    disabled: true,
                    slide: debounce(function(event, ui) {
                        $scope.myScalar = ui.value;
                        $scope.$emit("slider.changed", {value: ui.value});
                        drawCanvas();
                        drawOppHeat();
                    }, 10),
                    stop: function(event, ui) {
                        $scope.$emit("slider.changed", {
                            value: ui.value
                        });
                        drawCanvas();
                        drawOppHeat();
                    }
                }).each(function() {
                    // Draw tick labels
                    var opt = $(this).data().uiSlider.options;
                    var vals = opt.max - opt.min;
                    for (var i = 0; i <= vals; i++) {
                        var el = $('<label>' + (i + opt.min) + '</label>').css('left', (i / vals * 100) + '%');
                        $("#slider").append(el);
                    }
                });
                
                //initialize starting values
                $scope.$emit("slider.changed", {
                    value: 0.5
                });
            }

            $scope.$watch("partnerHeatAction", function() {
                drawCanvas();
                drawOppHeat();
            });
            $scope.$watch("myHeatAction", function() {
                drawCanvas();
                drawOppHeat();
            });


            function drawCanvas() {
                var canvas = document.getElementById("crossHairs");
                var ctx = canvas.getContext('2d');
                canvas.width = canvas.width;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                ctx.strokeStyle = "#333333";    
                //draw labels and ticks
                ctx.lineWidth = 2;
                

                // Partner draws horizontal line
                ctx.moveTo(0, canvas.height * (1-$scope.partnerScalar));
                ctx.lineTo(canvas.width, canvas.height * (1-$scope.partnerScalar));
                
                ctx.stroke();
                ctx.closePath();

                // Player draws vertical line
                ctx.moveTo(canvas.width * $scope.myScalar, 0);
                ctx.lineTo(canvas.width * $scope.myScalar, canvas.height);
                ctx.stroke();
                ctx.closePath();                
            }

            function heat(x, y) {
                var first   =   $scope.matrix[0][0][0];
                var second  =   $scope.matrix[0][1][0];
                var third   =   $scope.matrix[1][0][0];
                var fourth  =   $scope.matrix[1][1][0];

                return (first*(x*y) + second*x*(1-y) + third*(1-x)*y + fourth*(1-x)*(1-y));
            }

            function oppHeat(x, y) {
                var first   =   $scope.matrix[0][0][1];
                var second  =   $scope.matrix[1][0][1];
                var third   =   $scope.matrix[0][1][1];
                var fourth  =   $scope.matrix[1][1][1];

                return (first*(x*y) + second*x*(1-y) + third*(1-x)*y + fourth*(1-x)*(1-y));
            }

            function heat_color(value, range) {
                if (value == NaN || value == Infinity || value == -Infinity) {
                    value = 0;
                }
                value = (value - range[0]) / (range[1] - range[0]);
                return [255 * value, 0, 255 * (1 - value), 255 * (1 - value/2)];
            }

            function redraw() {
                range = [undefined, undefined];
                heatmap = undefined;
                values = undefined;

                var ctx = $("#actionSpace").loadCanvas();
                var width = ctx.canvas.width;
                var height = ctx.canvas.height;
                if (heatmap == undefined) {
                    heatmap = ctx.createImageData(width, height);
                    values = [];
                    for (var y = 0; y < height; y++) {
                        for (var x = 0; x < width; x++) {
                            var value = heat(x / width, y / height);
                            if (range[0] == undefined || value < range[0]) {
                                range[0] = value;
                            }
                            if (range[1] == undefined || value > range[1]) {
                                range[1] = value;
                            }
                            values.push(value);
                        }
                    }
                    for (var y = 0; y < height; y++) {
                        for (var x = 0; x < width; x++) {
                            var index = (y * width + x) * 4;
                            var color = heat_color(values[index / 4], range);
                            heatmap.data[index] = color[0];
                            heatmap.data[++index] = color[1];
                            heatmap.data[++index] = color[2];
                            heatmap.data[++index] = color[3];
                        }
                    }
                }

                ctx.putImageData(heatmap, 0, 0);
            }



            var getMouse = function(canvast, evt) {
                var rect = canvas.getBoundingClientRect();
                return {
                    x: evt.clientX - rect.left,
                    y: evt.clientY - rect.top
                };
            }
        }
    }
}]);