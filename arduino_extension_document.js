/*
 *This program is free software: you can redistribute it and/or modify
 *it under the terms of the GNU General Public License as published by
 *the Free Software Foundation, either version 3 of the License, or
 *(at your option) any later version.
 *
 *This program is distributed in the hope that it will be useful,
 *but WITHOUT ANY WARRANTY; without even the implied warranty of
 *MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *GNU General Public License for more details.
 *
 *You should have received a copy of the GNU General Public License
 *along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// ext는 extension에 기능을 더하자는 것이였지만 여기서는
// 빈 object가 온다. 여기에 뭔가를 채울 것이다. 그게 이 모듈의
// 목적
(function(ext) {

    // Arduion와 통신을 위한 명령 코드
    // formata라는 프로토콜을 사용한다. MIDI 프로토콜에 영향을 받았다고는
    // 하는데 코드를 본 것은 아니니 모르겠다.
    // 암튼, 아래 코드는 아두이노에 줄수 있는 명령이고 이것이 이 모듈의 한계
    // 이기도 하다.
    var PIN_MODE = 0xF4,               
        REPORT_DIGITAL = 0xD0,
        REPORT_ANALOG = 0xC0,
        DIGITAL_MESSAGE = 0x90,
        START_SYSEX = 0xF0,
        END_SYSEX = 0xF7,
        QUERY_FIRMWARE = 0x79,
        REPORT_VERSION = 0xF9,
        ANALOG_MESSAGE = 0xE0,
        ANALOG_MAPPING_QUERY = 0x69,
        ANALOG_MAPPING_RESPONSE = 0x6A,
        CAPABILITY_QUERY = 0x6B,
        CAPABILITY_RESPONSE = 0x6C;

    // 아래는 관련 상수들
    // 이런 상수들을 찾아서 이렇게 정의하는 것도 신기하다.
    // 어떻게 알고 다 넣었지. 
    var INPUT = 0x00,
        OUTPUT = 0x01,
        ANALOG = 0x02,
        PWM = 0x03,
        SERVO = 0x04,
        SHIFT = 0x05,
        I2C = 0x06,
        ONEWIRE = 0x07,
        STEPPER = 0x08,
        ENCODER = 0x09,
        SERIAL = 0x0A,
        PULLUP = 0x0B,             // 이건 사용은 하지 않지만 있기는 하다. firmata 지원없다.
        IGNORE = 0x7F,
        TOTAL_PIN_MODES = 13;      // 총 핀의 수, 아두이노 UNO 호환 보드만 지원

    var LOW = 0,
        HIGH = 1;

    // 통신 패킷 사이즈 4K
    var MAX_DATA_BYTES = 4096;
    // 가상의 핀 갯수일 수 있겠다. 우노 총 13다.
    // 뭔가 이름과 하고 있는 일이 맞지 않는 느낌이다.
    var MAX_PINS = 128;

    // System 명령를 주고 받고 있는 중인지 표시
    // 명령을 전달하고 응답 메시지까지를 표시한다.
    var parsingSysex = false,   

        // 필요한 데이터 수, 명령에 따라서 더 받아야 하는 데이터 량이 다르니
        waitForData = 0,
        // 두개 이상의 바이트 데이터를 받아야 하는 명령 저장
        executeMultiByteCommand = 0,
        // UNO의 핀 하나하나를 여기서는 channel이라고 한다.
        multiByteChannel = 0,
        // sysex를 위해서 읽는 데이터 수
        sysexBytesRead = 0,
        // 외부에서 들어온 데이터 보관용 버퍼
        // Uint8Array가 안보이기는 하지만 그냥 Array 인데 UINT 값을 넣기 위한
        // 것으로 보이니 지금부터 그렇게 보자. 버퍼로만
        storedInputData = new Uint8Array(MAX_DATA_BYTES);

    // 16개 바이트를 저장할 데이터,
    // index = pin 이다. 16개나 할당한 것은 2의 배수를 지키기 위한 것일 수도
    var digitalOutputData = new Uint8Array(16),   // uno로 보낼 데이터 보관
        digitalInputData = new Uint8Array(16),    // 받은 데이터 보관
        analogInputData = new Uint16Array(16);    // 아날로그 데이터 보관 

    // 아날로그 채널을 MAX_PINS(128) 하고 있는데
    // 여기까지로 보면 아직모르겠다. 이렇게 많이 필요할까??
    var analogChannel = new Uint8Array(MAX_PINS);

    // 핀모드를 초기화한다.
    // 핀모드(INPUT, OUTPUT 등)별 등록된 pin을 기록하기위해서 pinModes의
    // element가 array이다.
    // 예:
    // pinModes[INPUT] = [1,2,3]
    // pinModes[OUTPUT] = [13]
    var pinModes = [];
    for (var i = 0; i < TOTAL_PIN_MODES; i++) pinModes[i] = [];

    // 버전 정보, firmata의 버전
    var majorVersion = 0,
        minorVersion = 0;

    // 연결 상태 
    var connected = false;
    // 연결되었 때의 Noti
    var notifyConnection = false;
    // 디바이스 객체
    var device = null;
    // 입력 받은 데이터, 디바이스에서 온
    var inputData = null;

    
    // TEMPORARY WORKAROUND
    // Since _deviceRemoved is not used with Serial devices
    // ping device regularly to check connection
    // pinging 이면 100ms 마다 ping보낸다. 안두이노를 연결시키면
    // tx, rx가 그렇게 깜빡이던 이유다
    var pinging = false;
    // ping 한 갯수
    var pingCount = 0;
    // ping을 위한 timer id
    var pinger = null;

    // HW 조회를 위한 위한 객체
    // 바로 아래 정의가 있다.
    var hwList = new HWList();

    // js에서 함수를 정의할 때
    //  - function <이름>() { <함수정의> }
    //  - var <이름> = function() { <함수정의> }
    // 크게 두가지 방식이 있는데 이 코드는 첫번째 방식을 주로 사용한다.
    // 첫번째 방식은 선언이 뒤에 있어서 코드의 모든 영역에서 사용할 수 있다.

    // scratch X의 UI에서 지정한 내용을 지정하는 객체
    // 예를 들어 pin 13을 LED A로 지정하면 이 객체에 기록된다.
    function HWList() {

        // UI에서 지정한 설정을 정하는 컨테이너
        this.devices = [];

        // 설정 정보 등록
        // dev: 이름(예: LED A)
        // pin: 핀 번호
        this.add = function(dev, pin) {
            // 기존 리스에서 같은 이름을 찾는다.
            var device = this.search(dev);
            if (!device) {
                // 기존 데이터가 없으면 추가하고
                device = {name: dev, pin: pin, val: 0};
                this.devices.push(device);
            } else {
                // 있으면 초기화 한다.
                device.pin = pin;
                device.val = 0;
            }
        };

        // 같은 이름의 device를 찾는다.
        // device라고 하니까 좀 혼란스럽기는하지만 계속 따라가보자.
        this.search = function(dev) {
            // 모든 목록을 순환해서 이름을 찾아본다.
            // javascript 에서 순환하는 방식중에 for -- in 도 있다.
            // 아래 코드를 바꾸면
            // for(var device in devices)
            // 코드가 더 간결해진다.
            for (var i=0; i<this.devices.length; i++) {
                if (this.devices[i].name === dev)
                    return this.devices[i];
            }

            // 못 찾으면 널
            return null;
        };
    }

    // 초기화 코드
    // 우노의 SW 버전을 확인한 직후에 호출된다. 
    function init() {

        // 16의 핀 (퍼마타의 스펙인듯한데.)에 대한 정보를 요청한다.
        for (var i = 0; i < 16; i++) {

            // 보낸 명령을 Array로 만든다.
            // 어떤 명령인지는 firmata 코드를 봐야 았겠다. 여기서는
            // 추축만 한다.
            var output = new Uint8Array([REPORT_DIGITAL | i, 0x01]);
            // device 객체가 통신을 주관한다.
            // 명령을 실제로 보낸다.
            device.send(output.buffer);
        }

        // 할 수 있는 spec을 조회한다.
        queryCapabilities();

        // TEMPORARY WORKAROUND
        // Since _deviceRemoved is not used with Serial devices
        // ping device regularly to check connection
        // ping은 연결을 확인하기 위한 것이다.
        // 100 ms 마다 호출된다.
        pinger = setInterval(function() {
            // pinging 상태 즉, ping을 해야 하는 상황이라면
            if (pinging) {
                // ping을 보내고 받지 못한 횟수가 6회 이상이면
                // 연결을 끊는다.
                if (++pingCount > 6) {
                    // timer 초기화 시키고 device를 끊어버린다.
                    clearInterval(pinger);
                    pinger = null;
                    connected = false;
                    if (device) device.close();
                    device = null;
                    return;
                }
            } else {
                // 아직 ping 하지 않는 상태인데
                if (!device) {
                    // device 객체가 아직 있으면 ping timer를 제거한다.
                    // 아직 연결할 device를 못찾았을 때인가? 
                    clearInterval(pinger);
                    pinger = null;
                    return;
                }
                // firware 를 조회해본다.
                queryFirmware();
                // ping을 주기적으로 수행한다.
                pinging = true;
            }
        }, 100);
    }


    // 특정 핀에 해당 mode를 설정할 수 있는지 확인한다.
    function hasCapability(pin, mode) {
        if (pinModes[mode].indexOf(pin) > -1)
            return true;
        else
            return false;
    }

    // 디바이스에 요청한다.
    function queryFirmware() {
        // 시스템 정보 요청
        // 명령을 이렇게 array로 표현하는 것도 좋다. 한번에 다 보이기도 하고
        // 하지만 이렇게 할 수 있는 것은 간단한 명령에 들어가는 데이터도
        // 단순한 것만 가능할 듯 조금만 복잡해지만 힘들어지지 않을까?
        // 개인적으로는 명령 패킷자체를 클래스로 만들고 보내기전에 encode 해서
        // stream으로 만드는 방식을 선호한다.코드가 길긴하지만 더 OOP같다는 생각 때문이다.
        var output = new Uint8Array([START_SYSEX, QUERY_FIRMWARE, END_SYSEX]);
        device.send(output.buffer);
    }

    // 디바이스의 스펙을 물어본다.
    function queryCapabilities() {
        console.log('Querying ' + device.id + ' capabilities');
        var msg = new Uint8Array([
            START_SYSEX, CAPABILITY_QUERY, END_SYSEX]);
        device.send(msg.buffer);
    }

    // 아날로그 연결 정보를 요청한다.
    function queryAnalogMapping() {
        console.log('Querying ' + device.id + ' analog mapping');
        var msg = new Uint8Array([
            START_SYSEX, ANALOG_MAPPING_QUERY, END_SYSEX]);
        device.send(msg.buffer);
    }

    // 특정 포트(핀)에 입력 데이터를 저장한다.
    function setDigitalInputs(portNum, portData) {
        digitalInputData[portNum] = portData;
    }

    // 아날로그 입력정보를 analogInputData에 넣어 둔다.
    // 아두이노는 10bit 분해능을 가진 아날로그 핀을 사용한다.
    // 0 ~ 1023 의 값을 갖는다.
    function setAnalogInput(pin, val) {
        analogInputData[pin] = val;
    }

    // 버전 정보를 저장한다.
    // 뭐 따로 하는 것도 없으면서 버전을 저장해둔다.
    // 나중을 위한 포석일까??
    function setVersion(major, minor) {
        majorVersion = major;
        minorVersion = minor;
    }

    // 시스템 명령에 대한 응답을 처리한다.
    function processSysexMessage() {
        // 첫번째 바이트는 어떤 종류의 응답인지 
        switch(storedInputData[0]) {
            
        case CAPABILITY_RESPONSE:
            // 스펙 요청에 대한 응답이면
            // MAX_PINS(127) 모두에
            for (var i = 1, pin = 0; pin < MAX_PINS; pin++) {
                // data가 0x7f면 끝을 의미할까?? 모르지만 바른 데이터는 아니다.
                while (storedInputData[i++] != 0x7F) {
                    // 위에서 i++ 했으면 i-1은 원래의 i 값이 된다.
                    // 변수를 하나 만드는 것이 이해하기 더 편했을 것
                    // storedInputdata로 들어온 데이터는 다음과 같은 형식
                    // <PIN 0의 모드> <resolution>  <PIN 1의 모드> <resolution> .....
                    pinModes[storedInputData[i-1]].push(pin);
                    // resolution은 분해능 같은데 우노의 아날로그 모드는 10 bit 분해능이다 
                    i++; //Skip mode resolution
                    
                }

                // 받은 데이터 만큼 처리했으면 종료
                if (i == sysexBytesRead) break;
            }
            // 아날로그 맵핑 정보 요청
            queryAnalogMapping();
            break;
        case ANALOG_MAPPING_RESPONSE:
            // 아날로그 맵핑 정보를 받으면
            // 아날로그 PIN정보의 를 127(0x7F)로 초기화
            for (var pin = 0; pin < analogChannel.length; pin++)
                analogChannel[pin] = 127;
            // 받은 데이터 만큼 analogChannel에 그대로 기록한다.
            // 여기서 기록되는 정보는 맵핑되었다는 정보다.
            for (var i = 1; i < sysexBytesRead; i++)
                analogChannel[i-1] = storedInputData[i];
            // 맵핑된 아날로그 채널(핀)이라면 데이터를 읽어오라는 명령을 보낸다.
            for (var pin = 0; pin < analogChannel.length; pin++) {
                if (analogChannel[pin] != 127) {
                    var out = new Uint8Array([
                        REPORT_ANALOG | analogChannel[pin], 0x01]);
                    device.send(out.buffer);
                }
            }

            // 아날로그 맵핑정보를 받으면 연결되었다는 notifyConnection을 true로
            // 했다가 100ms 후 다시 false로 한다.
            // scratchx의 이벤트중에 "디바이스 연결되면"이라는 조건이 있는데
            // 그것을 위한 것
            notifyConnection = true;
            setTimeout(function() {
                notifyConnection = false;
            }, 100);
            break;
        case QUERY_FIRMWARE:
            // 펌웨어 정보 요청을 받으면
            if (!connected) {
                // 연결되어 있지 않으면 ping을 하지 못하도록 하고
                clearInterval(poller);
                poller = null;
                // watchdog 또 제거한다.
                clearTimeout(watchdog);
                watchdog = null;
                connected = true;
                // 200ms 후에 다시 init()를 호출한다.
                // ?? 근데 왜 init를 요청할까 연결이 안된 거이니까
                //    다시 연결을 시도하고 Init를 해야 할 텐데. 연결을 하는 코드는 없다.
                //    device.open을 해야 할텐데.
                SetTimeout(Init, 200);
            }
            // ping을 하지 않도록 한다.
            // 여기서 pinging이 false이며 다시 queryFirmware를 요청할 것이고
            // 다시 여기로 올 것이다. QUERY_FIRMWARE 요청을 PING 메시지로 사용하고
            // 있다. PING 메시지가 따로 있을 것이라고 예상했는데 아니였다.
            pinging = false;
            pingCount = 0;
            break;
        }
    }

    // 아두이노에서 온 데이터를 처리한다.
    function processInput(inputData) {
        // 모든 데이터를 검사한다.
        for (var i=0; i < inputData.length; i++) {

            // 시스템 명령을 처리하고 있는 중인다.

            if (parsingSysex) {
                // ENS_SYSEX가 오면
                // processSysexMessage()로 메시지 처리
                if (inputData[i] == END_SYSEX) {
                    parsingSysex = false;
                    processSysexMessage();
                } else {
                    // 데이터를 버퍼에 저장한다.
                    // sysexBytesRead로 읽은 바이트 수를 샌다.
                    storedInputData[sysexBytesRead++] = inputData[i];
                }
            } else if (waitForData > 0 && inputData[i] < 0x80) {
                // 더 들어와야 할 데이터가 있고 그게 0x80 이하이면
                // 버퍼에 저장해준다. 이때 데이터가 0x80 이하 즉, 7bit이다.
                // 7bit 데이트는 참으로 오랜만에 보게된다. 현재는 거의 없지 않나..
                storedInputData[--waitForData] = inputData[i];
                // 필요한 데이터도 다 읽었고 여러 바이트가 요구되는 명령을 처리한다.
                if (executeMultiByteCommand !== 0 && waitForData === 0) {
                    switch(executeMultiByteCommand) {
                    case DIGITAL_MESSAGE:
                        // DIGITAL_MESSAGE가 오면 주어진 channel에 기록한다.
                        // 7bit 데이터이니 7bit 이동해서 두개의 바이트를 합친다.
                        setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);
                        break;
                    case ANALOG_MESSAGE:
                        // 아날로그 메시지이면 아날로그 채널에 기록해준다.
                        setAnalogInput(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);
                        break;
                    case REPORT_VERSION:
                        // 버전도 기록해둔다.
                        setVersion(storedInputData[1], storedInputData[0]);
                        break;
                    }
                }
            } else {
                // 명
                if (inputData[i] < 0xF0) {
                    // 앞에 4bit가 명령
                    // REPORT_DIGITAL(0xD0)
                    command = inputData[i] & 0xF0;
                    // 뒤쪽은 핀 번호(16개)
                    multiByteChannel = inputData[i] & 0x0F;
                } else {
                    // 0xF0 이상은 그자체로 명령
                    // ex) ANALOG_MESSAGE(0xE0) 등..
                    command = inputData[i];
                }

                // 명령을 보면 처리
                switch(command) {
                case DIGITAL_MESSAGE:
                case ANALOG_MESSAGE:
                case REPORT_VERSION:
                    // 2 byte가 필요
                    waitForData = 2;
                    executeMultiByteCommand = command;
                    break;
                case START_SYSEX:
                    // SYSEX 과정 시작
                    parsingSysex = true;
                    sysexBytesRead = 0;
                    break;
                }
            }
        }
    }

    // 디바이스 핀 설정(INPUT, OUTPUT, ANALOG)
    function pinMode(pin, mode) {
        var msg = new Uint8Array([PIN_MODE, pin, mode]);
        // 명령을 보낸다. (3 byte)
        device.send(msg.buffer);
    }

    // 아날로그 리드
    function analogRead(pin) {
        // 기능한 핀이라면
        if (pin >= 0 && pin < pinModes[ANALOG].length) {
            // 버퍼의 값을 읽는다.
            // 값이 결국 0 ~ 100 으로 환산해서 반환된다.
            return Math.round((analogInputData[pin] * 100) / 1023);
        } else {

            // 에러메시지 콘솔에 출력
            var valid = [];
            for (var i = 0; i < pinModes[ANALOG].length; i++)
                valid.push(i);
            console.log('ERROR: valid analog pins are ' + valid.join(', '));
            return;
        }
    }

    // 디지털 값 읽기
    function digitalRead(pin) {

        // 가능한 핀인지 확인
        if (!hasCapability(pin, INPUT)) {
            console.log('ERROR: valid input pins are ' + pinModes[INPUT].join(', '));
            return;
        }

        // 핀모드 설정 (INPUT)
        // 여러번 읽으면 여러번 설정해야 하는데..
        // 뭐 이정도는 무시하는 것인가?
        pinMode(pin, INPUT);

        // digitalInputData의 구조: (2바이트 구성)
        // [ 7bit ][ 7bit ] => 각 비트하나가 각 핀의 on/off 를 의미
        // 13핀을 예로 들면:
        // 13 >> 3 == 13 / 8 == 1 즉, digitalInputData[1]
        // 이중에서 13핀은 6번째 비트가 13핀의 비트임
        // 이게 1이면 13핀이 HIGH임
        return (digitalInputData[pin >> 3] >> (pin & 0x07)) & 0x01;
    }


    // 아날로그 쓰기( PWM 설정 ) 0~100 사이 값으로 받음
    function analogWrite(pin, val) {

        // PWM 설정 가능한 핀인지 확인
        if (!hasCapability(pin, PWM)) {
            console.log('ERROR: valid PWM pins are ' + pinModes[PWM].join(', '));
            return;
        }
        // 범위 확인
        if (val < 0) val = 0;
        else if (val > 100) val = 100;

        // 실제로 적용할 범위로 변환
        val = Math.round((val / 100) * 255);

        // 모드 설정
        pinMode(pin, PWM);
        // 메시지를 보낸다. (3 byte)
        var msg = new Uint8Array([
            ANALOG_MESSAGE | (pin & 0x0F),
            val & 0x7F,
            val >> 7]);
        device.send(msg.buffer);
    }

    // 디지털 핀에 쓰기
    function digitalWrite(pin, val) {
        // 주어진 핀이 사용가는한지 확인
        if (!hasCapability(pin, OUTPUT)) {
            console.log('ERROR: valid output pins are ' + pinModes[OUTPUT].join(', '));
            return;
        }

        // 포트 번호
        // 디지털 신호은 1비트이므로 13개 핀을 할당하는데 2바이트면 충분한다.
        // 포트 번호는 이 2바이트 중 어떤것에 핀 정보가 들어갈지 결정하는 것
        var portNum = (pin >> 3) & 0x0F;

        // 적할한 비트에 같 설정
        if (val == LOW)
            digitalOutputData[portNum] &= ~(1 << (pin & 0x07));
        else
            digitalOutputData[portNum] |= (1 << (pin & 0x07));

        // output으로 모드 설정
        pinMode(pin, OUTPUT);
        // 명령 3byte
        var msg = new Uint8Array([
            DIGITAL_MESSAGE | portNum,
            digitalOutputData[portNum] & 0x7F,
            digitalOutputData[portNum] >> 0x07]);
        device.send(msg.buffer);
    }

    // servo 모터 제어
    function rotateServo(pin, deg) {
        // 능력이 되는지 확인
        if (!hasCapability(pin, SERVO)) {
            console.log('ERROR: valid servo pins are ' + pinModes[SERVO].join(', '));
            return;
        }

        // 핀모드 설정
        pinMode(pin, SERVO);

        // 명령 3 byte
        // deg는 0<= x <= 180
        var msg = new Uint8Array([
            ANALOG_MESSAGE | (pin & 0x0F),
            deg & 0x7F,
            deg >> 0x07]);
        device.send(msg.buffer);
    }


    //--------------------
    // 여기서부터 외부에 노출되는 것이다.
    // scratchx 의 block과 매칭된다.
    // 하드웨어가 연결될 때 true가 된다.
    // 이 함수를 호출하는 것은 주체는 블록를 사용하는 놈이 될 것이다.
    ext.whenConnected = function() {
        if (notifyConnection) return true;
        return false;
    };

    // 아날로그 쓰기
    ext.analogWrite = function(pin, val) {
        analogWrite(pin, val);
    };

    // 디지털 쓰기
    // val는 on / off 가 된다.
    // menu는 i18n을 위한 것
    ext.digitalWrite = function(pin, val) {
        if (val == menus[lang]['outputs'][0])
            digitalWrite(pin, HIGH);
        else if (val == menus[lang]['outputs'][1])
            digitalWrite(pin, LOW);
    };

    // 아날로그 읽기
    ext.analogRead = function(pin) {
        return analogRead(pin);
    };

    // 디지털 읽기
    ext.digitalRead = function(pin) {
        return digitalRead(pin);
    };

    // 아날로그 값이 특정 값으로 특정 연산을 했을 때 true이면 true 리턴
    ext.whenAnalogRead = function(pin, op, val) {
        if (pin >= 0 && pin < pinModes[ANALOG].length) {
            if (op == '>')
                return analogRead(pin) > val;
            else if (op == '<')
                return analogRead(pin) < val;
            else if (op == '=')
                return analogRead(pin) == val;
            else
                return false;
        }
    };

    // 디지털 값이 on / off로 주어진 값과 같으면 true
    ext.whenDigitalRead = function(pin, val) {
        if (hasCapability(pin, INPUT)) {
            if (val == menus[lang]['outputs'][0])
                return digitalRead(pin);
            else if (val == menus[lang]['outputs'][1])
                return digitalRead(pin) === false;
        }
    };

    // 특정 디바이스(LED A, LED B 등)에 특정 pin을 할당한다.
    ext.connectHW = function(hw, pin) {
        hwList.add(hw, pin);
    };

    // servo 모터를 움직인다.
    ext.rotateServo = function(servo, deg) {
        // 설정 기록을 찾는다.
        var hw = hwList.search(servo);
        if (!hw) return;

        // 범위를 보정한다.
        if (deg < 0) deg = 0;
        else if (deg > 180) deg = 180;

        // 실제로 움직이는 명령 보내고
        rotateServo(hw.pin, deg);

        // 명령을 기록한다.
        hw.val = deg;
    };

    // 어느 정도 차이만큼 움직인다.
    // rotate 정보를 기억하는 이유가 이 명령 때문이다.
    ext.changeServo = function(servo, change) {
        var hw = hwList.search(servo);
        if (!hw) return;

        // 기존 각도에 차이만큼 추가해서 명령을 내린다.
        var deg = hw.val + change;
        if (deg < 0) deg = 0;
        else if (deg > 180) deg = 180;
        rotateServo(hw.pin, deg);
        hw.val = deg;
    };

    // LED 밝기를 설정한다.
    ext.setLED = function(led, val) {
        var hw = hwList.search(led);
        if (!hw) return;

        // 아날로그로 설정 0~100사이 값
        analogWrite(hw.pin, val);
        hw.val = val;
    };

    // LED을 val만큼 증가한 밝기로 설정한다.
    ext.changeLED = function(led, val) {
        var hw = hwList.search(led);
        if (!hw) return;

        // 기존 값에 val만큼 증가시킨다.
        var b = hw.val + val;

        // 데이터 범위 조정
        if (b < 0) b = 0;
        else if (b > 100) b = 100;

        // 설정
        analogWrite(hw.pin, b);
        hw.val = b;
    };


    // LED를 켜고 끈다.
    ext.digitalLED = function(led, val) {
        var hw = hwList.search(led);
        if (!hw) return;

        // 여기는 menu의 것을 쓰지 않고 문자열 비교를 한다.
        if (val == 'on') {
            // 디지털 HIGH로 설정하고 val는 255 최고 밝기로 기록
            digitalWrite(hw.pin, HIGH);
            // 아래는 100이 되어야 되지 않나? LED 밝기 범위가 0~100이니 말이다.
            // 개발자가 일관성을 가지고 개발하는 것은 참어려운듯하다.
            hw.val = 255;
        } else if (val == 'off') {

            // LED OFF
            digitalWrite(hw.pin, LOW);
            hw.val = 0;
        }
    };

    // 아날로그 값 읽기
    ext.readInput = function(name) {
        var hw = hwList.search(name);
        if (!hw) return;
        // 아날로그 값을 읽는다.
        return analogRead(hw.pin);
    };

    // 버튼이 정해진 state 이면 true
    ext.whenButton = function(btn, state) {
        var hw = hwList.search(btn);
        if (!hw) return;

        // 핀이 HIGH 이면 눌린 것으로 본다.
        // 그렇다면 scratchx은 무조건 pull-down이 되어야 한다.
        if (state === 'pressed')
            return digitalRead(hw.pin);
        else if (state === 'released')
            return !digitalRead(hw.pin);
    };

    // 버튼이 눌렸는지 true 아니면 false
    ext.isButtonPressed = function(btn) {
        var hw = hwList.search(btn);
        if (!hw) return;
        return digitalRead(hw.pin);
    };

    // input 값이 조건에 맞으면 true 아니면 false
    ext.whenInput = function(name, op, val) {
        var hw = hwList.search(name);
        if (!hw) return;
        if (op == '>')
            return analogRead(hw.pin) > val;
        else if (op == '<')
            return analogRead(hw.pin) < val;
        else if (op == '=')
            return analogRead(hw.pin) == val;
        else
            return false;
    };

    // 특정 범위의 값을 다른 범위의 값으로 맵핑한다.
    ext.mapValues = function(val, aMin, aMax, bMin, bMax) {
        var output = (((bMax - bMin) * (val - aMin)) / (aMax - aMin)) + bMin;
        return Math.round(output);
    };

    // 디바이스 상태 표시
    // 앱에 보면 디바이스가 연결되면 초록색이되고 아니면 오렌지 색이 된다.
    ext._getStatus = function() {
        if (!connected)
            return { status:1, msg:'Disconnected' };
        else
            return { status:2, msg:'Connected' };
    };

    // 디바이스가 제거될 때를 이벤트로 만들고 싶었나보다.
    // 디바이스 연결이 끝어지면 여기까지 오지 않고 ScrachDevice 모듈에서 에러를 낼테니
    // 여기서 처리하지 않아도 되니 구현하지 않은 것이 아닐까..
    ext._deviceRemoved = function(dev) {
        console.log('Device removed');
        // Not currently implemented with serial devices
    };

    //------------------------
    // 여기부터 디바이스 연결과 관련된 코드이다.

    // 아두이노로 추정되는 디바이스들 목록
    // 이 목록의 디바이스를 하나 하나 테스트할 것이다.
    var potentialDevices = [];

    // 찾은 device를 목록에 추가
    ext._deviceConnected = function(dev) {
        potentialDevices.push(dev);
        if (!device)
            tryNextDevice();
    };

    var poller = null;
    var watchdog = null;
    // 디바이스 연결을 해본다.
    function tryNextDevice() {
        // 목록의 앞줄에서 하나를 빼온다.
        device = potentialDevices.shift();
        if (!device) return;  // 목록이 비어있었으면 모두 종료

        // 디바이스에 시리얼 연결을 해본다.
        // firmata는 57600 으로 연결한다.
        device.open({ stopBits: 0, bitRate: 57600, ctsFlowControl: 0 });
        // 그럼 콘솔에 연결중 메시지가 보인다.
        console.log('Attempting connection with ' + device.id);

        // 디바이스에 데이터을 받으면 처리할 핸들러를 붙인다.
        // 이 핸들러는 processInput으로 데이터를 넘긴다.
        device.set_receive_handler(function(data) {
            var inputData = new Uint8Array(data);
            processInput(inputData);
        });

        // 1초에 한번씩 firmware 정보를 요청한다.
        // 연결되면 watchdog을 끄고 초기화 들어간다.
        poller = setInterval(function() {
            queryFirmware();
        }, 1000);

        // 연결이 안될 때를 대비해서 5초가 기다린다.
        // 기다려도 연락이 없다면 다음 디바이스를 시도해본다.
        watchdog = setTimeout(function() {
            clearInterval(poller);
            poller = null;
            device.set_receive_handler(null);
            device.close();
            device = null;
            tryNextDevice();
        }, 5000);
    }

    // 종료
    // 이게 호출되는 곳이 있었는지 모르겠다.
    ext._shutdown = function() {
        // 모든 데이터를 초기화해야한다.
        // TODO: Bring all pins down
        if (device) device.close();
        if (poller) clearInterval(poller);
        device = null;
    };

    // Check for GET param 'lang'
    // local확인, URL의 파라미터로 들어온다.
    // window.location.search이 ?xxx=xxx 의 값을 가지고 있다.
    // ?xxxx/ ==> xxxx   으로 바꾼다.
    var paramString = window.location.search.replace(/^\?|\/$/g, '');

    // &으로 분리한다.
    var vars = paramString.split("&");

    // 기본값은 영어
    var lang = 'en';

    // 모든 param을 조사해서 lang 이 있으면 그 값으로 언어를 설정한다.
    for (var i=0; i<vars.length; i++) {
        var pair = vars[i].split('=');
        if (pair.length > 1 && pair[0]=='lang')
            lang = pair[1];
    }

    // TODO :  근데 디폴트 값을 다시 확인하지 않고 있다. 지원하지 않는 local을
    //         사용하면 버그가 될텐데.


    // 화면에 표시된 블럭들이다.
    var blocks = {
        en: [
            ['h', 'when device is connected', 'whenConnected'],
            [' ', 'connect %m.hwOut to pin %n', 'connectHW', 'led A', 3],
            [' ', 'connect %m.hwIn to analog %n', 'connectHW', 'rotation knob', 0],
            ['-'],
            [' ', 'set %m.leds %m.outputs', 'digitalLED', 'led A', 'on'],
            [' ', 'set %m.leds brightness to %n%', 'setLED', 'led A', 100],
            [' ', 'change %m.leds brightness by %n%', 'changeLED', 'led A', 20],
            ['-'],
            [' ', 'rotate %m.servos to %n degrees', 'rotateServo', 'servo A', 180],
            [' ', 'rotate %m.servos by %n degrees', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', 'when %m.buttons is %m.btnStates', 'whenButton', 'button A', 'pressed'],
            ['b', '%m.buttons pressed?', 'isButtonPressed', 'button A'],
            ['-'],
            ['h', 'when %m.hwIn %m.ops %n%', 'whenInput', 'rotation knob', '>', 50],
            ['r', 'read %m.hwIn', 'readInput', 'rotation knob'],
            ['-'],
            [' ', 'set pin %n %m.outputs', 'digitalWrite', 1, 'on'],
            [' ', 'set pin %n to %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'when pin %n is %m.outputs', 'whenDigitalRead', 1, 'on'],
            ['b', 'pin %n on?', 'digitalRead', 1],
            ['-'],
            ['h', 'when analog %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'read analog %n', 'analogRead', 0],
            ['-'],
            ['r', 'map %n from %n %n to %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        de: [
            ['h', 'Wenn Arduino verbunden ist', 'whenConnected'],
            [' ', 'Verbinde %m.hwOut mit Pin %n', 'connectHW', 'LED A', 3],
            [' ', 'Verbinde %m.hwIn mit Analog %n', 'connectHW', 'Drehknopf', 0],
            ['-'],
            [' ', 'Schalte %m.leds %m.outputs', 'digitalLED', 'LED A', 'Ein'],
            [' ', 'Setze %m.leds Helligkeit auf %n%', 'setLED', 'LED A', 100],
            [' ', 'Ändere %m.leds Helligkeit um %n%', 'changeLED', 'LED A', 20],
            ['-'],
            [' ', 'Drehe %m.servos auf %n Grad', 'rotateServo', 'Servo A', 180],
            [' ', 'Drehe %m.servos um %n Grad', 'changeServo', 'Servo A', 20],
            ['-'],
            ['h', 'Wenn %m.buttons ist %m.btnStates', 'whenButton', 'Taste A', 'gedrückt'],
            ['b', '%m.buttons gedrückt?', 'isButtonPressed', 'Taste A'],
            ['-'],
            ['h', 'Wenn %m.hwIn %m.ops %n%', 'whenInput', 'Drehknopf', '>', 50],
            ['r', 'Wert von %m.hwIn', 'readInput', 'Drehknopf'],
            ['-'],
            [' ', 'Schalte Pin %n %m.outputs', 'digitalWrite', 1, 'Ein'],
            [' ', 'Setze Pin %n auf %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'Wenn Pin %n ist %m.outputs', 'whenDigitalRead', 1, 'Ein'],
            ['b', 'Pin %n ein?', 'digitalRead', 1],
            ['-'],
            ['h', 'Wenn Analog %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'Wert von Analog %n', 'analogRead', 0],
            ['-'],
            ['r', 'Setze %n von %n %n auf %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        fr: [
            ['h', "Quand l'appareil est connecté", 'whenConnected'],
            [' ', 'Connecté %m.hwOut au pin %n', 'connectHW', 'LED A', 3],
            [' ', 'Connecté %m.hwIn au pin analogue %n', 'connectHW', 'Potentiomètre', 0],
            ['-'],
            [' ', 'Régler %m.leds LED %m.output Sortie', 'digitalLED', 'LED A', 'ON'],
            [' ', 'Régler %m.leds Luminosité de la LED à %n%', 'setLED', 'LED A', 100],
            [' ', 'Changer %m.leds Luminosité de la LED de %n%', 'changeLED', 'LED A', 20],
            ['-'],
            [' ', 'Tourner %m.servos Servo Moteur à %n degrés', 'rotateServo', 'Servo Moteur A', 180],
            [' ', 'Tourner %m.servos Servo Moteur de %n degrés', 'changeServo', 'Servo Moteur A', 20],
            ['-'],
            ['h', 'Quand %m.buttons Bouton est %m.btnStates', 'whenButton', 'Bouton A', 'Appuyé'],
            ['b', 'Le %m.buttons est-il pressé?', 'isButtonPressed', 'Bouton A'],
            ['-'],
            ['h', 'Quand %m.hwIn %m.ops %n%', 'whenInput', 'Potentiomètre', '>', 50],
            ['r', 'Lire %m.hwIn', 'readInput', 'Potentiomètre'],
            ['-'],
            [' ', 'Régler le Pin %n %m.outputs Sortie', 'digitalWrite', 1, 'ON'],
            [' ', 'Régler le Pin %n à %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'Quand le Pin %n est %m.outputs Sortie', 'whenDigitalRead', 1, 'ON'],
            ['b', 'Le Pin %n est-il démarré?', 'digitalRead', 1],
            ['-'],
            ['h', 'Quand le Pin analogique est %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'Lire le Pin Analogique %n', 'analogRead', 0],
            ['-'],
            ['r', 'Mapper %n de %n %n à %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        it: [
            ['h', 'quando Arduino è connesso', 'whenConnected'],
            [' ', 'connetti il %m.hwOut al pin %n', 'connectHW', 'led A', 3],
            [' ', 'connetti il %m.hwIn ad analog %n', 'connectHW', 'potenziometro', 0],
            ['-'],
            [' ', 'imposta %m.leds a %m.outputs', 'digitalLED', 'led A', 'acceso'],
            [' ', 'porta luminosità di %m.leds a %n%', 'setLED', 'led A', 100],
            [' ', 'cambia luminosità di %m.leds a %n%', 'changeLED', 'led A', 20],
            ['-'],
            [' ', 'ruota %m.servos fino a %n gradi', 'rotateServo', 'servo A', 180],
            [' ', 'ruota %m.servos di %n gradi', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', 'quando tasto %m.buttons è %m.btnStates', 'whenButton', 'pulsante A', 'premuto'],
            ['b', '%m.buttons premuto?', 'isButtonPressed', 'pulsante A'],
            ['-'],
            ['h', 'quando %m.hwIn %m.ops %n%', 'whenInput', 'potenziometro', '>', 50],
            ['r', 'leggi %m.hwIn', 'readInput', 'potenziometro'],
            ['-'],
            [' ', 'imposta pin %n a %m.outputs', 'digitalWrite', 1, 'acceso'],
            [' ', 'porta pin %n al %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'quando pin %n è %m.outputs', 'whenDigitalRead', 1, 'acceso'],
            ['b', 'pin %n acceso?', 'digitalRead', 1],
            ['-'],
            ['h', 'quando analog %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'leggi analog %n', 'analogRead', 0],
            ['-'],
            ['r', 'porta %n da %n %n a %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        ja: [
            ['h', 'デバイスがつながったとき', 'whenConnected'],
            [' ', '%m.hwOut を %n ピンへつなぐ', 'connectHW', 'led A', 3],
            [' ', '%m.hwIn をアナログ入力 %n ピンへつなぐ', 'connectHW', 'rotation knob', 0],
            ['-'],
            [' ', '%m.leds を %m.outputs にする', 'digitalLED', 'led A', 'on'],
            [' ', '%m.leds の明るさを %n% にする', 'setLED', 'led A', 100],
            [' ', '%m.leds の明るさを %n% ずつ変える', 'changeLED', 'led A', 20],
            ['-'],
            [' ', '%m.servos を %n 度へ向ける', 'rotateServo', 'servo A', 180],
            [' ', '%m.servos を %n 度ずつ回す', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', '%m.buttons が %m.btnStates とき', 'whenButton', 'ボタン A', '押された'],
            ['b', '%m.buttons 押された', 'isButtonPressed', 'ボタン A'],
            ['-'],
            ['h', '%m.hwIn が %m.ops %n% になったとき', 'whenInput', '回転つまみ', '>', 50],
            ['r', '%m.hwIn の値', 'readInput', '回転つまみ'],
            ['-'],
            [' ', 'デジタル出力 %n を %m.outputs にする', 'digitalWrite', 1, 'on'],
            [' ', 'アナログ出力 %n を %n% にする', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'デジタル入力 %n が %m.outputs になったとき', 'whenDigitalRead', 1, 'on'],
            ['b', 'デジタル入力 %n はオン', 'digitalRead', 1],
            ['-'],
            ['h', 'アナログ入力 %n が %m.ops %n% になったとき', 'whenAnalogRead', 1, '>', 50],
            ['r', 'アナログ入力 %n の値', 'analogRead', 0],
            ['-'],
            ['r', '%n を %n ... %n から %n ... %n へ変換', 'mapValues', 50, 0, 100, -240, 240]
        ],
        ko: [
            ['h', '아두이노가 연결됐을 때', 'whenConnected'],
            [' ', '%m.hwOut 를 %n 번 핀에 연결하기', 'connectHW', 'led A', 3],
            [' ', '%m.hwIn 를 아날로그 %n 번 핀에 연결하기', 'connectHW', '회전 손잡이', 0],
            ['-'],
            [' ', '%m.leds 를 %m.outputs', 'digitalLED', 'led A', '켜기'],
            [' ', '%m.leds 의 밝기를 %n% 로 설정하기', 'setLED', 'led A', 100],
            [' ', '%m.leds 의 밝기를 %n% 만큼 바꾸기', 'changeLED', 'led A', 20],
            ['-'],
            [' ', '%m.servos 를 %n 도로 회전하기', 'rotateServo', '서보모터 A', 180],
            [' ', '%m.servos 를 %n 도 만큼 회전하기', 'changeServo', '서보모터 A', 20],
            ['-'],
            ['h', '%m.buttons 의 상태가 %m.btnStates 일 때', 'whenButton', '버튼 A', '눌림'],
            ['b', '%m.buttons 가 눌려져 있는가?', 'isButtonPressed', '버튼 A'],
            ['-'],
            ['h', '%m.hwIn 의 값이 %m.ops %n% 일 때', 'whenInput', '회전 손잡이', '>', 50],
            ['r', '%m.hwIn 의 값', 'readInput', '회전 손잡이'],
            ['-'],
            [' ', '%n 번 핀을 %m.outputs', 'digitalWrite', 1, '켜기'],
            [' ', '%n 번 핀의 값을 %n% 로 설정하기', 'analogWrite', 3, 100],
            ['-'],
            ['h', '%n 번 핀의 상태가 %m.outputs 일 때', 'whenDigitalRead', 1, '켜기'],
            ['b', '%n 번 핀이 켜져있는가?', 'digitalRead', 1],
            ['-'],
            ['h', '아날로그 %n 번 핀의 값이 %m.ops %n% 일 때', 'whenAnalogRead', 1, '>', 50],
            ['r', '아날로그 %n 번 핀의 값', 'analogRead', 0],
            ['-'],
            ['r', '%n 을(를) %n ~ %n 에서 %n ~ %n 의 범위로 바꾸기', 'mapValues', 50, 0, 100, -240, 240]
        ],
        nb: [
            ['h', 'når enheten tilkobles', 'whenConnected'],
            [' ', 'koble %m.hwOut til digital %n', 'connectHW', 'LED A', 3],
            [' ', 'koble %m.hwIn til analog %n', 'connectHW', 'dreieknapp', 0],
            ['-'],
            [' ', 'sett %m.leds %m.outputs', 'digitalLED', 'LED A', 'på'],
            [' ', 'sett %m.leds styrke til %n%', 'setLED', 'LED A', 100],
            [' ', 'endre %m.leds styrke med %n%', 'changeLED', 'LED A', 20],
            ['-'],
            [' ', 'rotér %m.servos til %n grader', 'rotateServo', 'servo A', 180],
            [' ', 'rotér %m.servos med %n grader', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', 'når %m.buttons %m.btnStates', 'whenButton', 'knapp A', 'trykkes'],
            ['b', '%m.buttons trykket?', 'isButtonPressed', 'knapp A'],
            ['-'],
            ['h', 'når %m.hwIn %m.ops %n%', 'whenInput', 'dreieknapp', '>', 50],
            ['r', '%m.hwIn verdi', 'readInput', 'dreieknapp'],
            ['-'],
            [' ', 'sett digital %n %m.outputs', 'digitalWrite', 1, 'på'],
            [' ', 'set utgang %n til %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'når digital %n er %m.outputs', 'whenDigitalRead', 1, 'på'],
            ['b', 'digital %n på?', 'digitalRead', 1],
            ['-'],
            ['h', 'når analog %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'analog %n verdi', 'analogRead', 0],
            ['-'],
            ['r', 'skalér %n fra %n %n til %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        nl: [
            ['h', 'als het apparaat verbonden is', 'whenConnected'],
            [' ', 'verbind %m.hwOut met pin %n', 'connectHW', 'led A', 3],
            [' ', 'verbind %m.hwIn met analoog %n', 'connectHW', 'draaiknop', 0],
            ['-'],
            [' ', 'schakel %m.leds %m.outputs', 'digitalLED', 'led A', 'on'],
            [' ', 'schakel %m.leds helderheid tot %n%', 'setLED', 'led A', 100],
            [' ', 'verander %m.leds helderheid met %n%', 'changeLED', 'led A', 20],
            ['-'],
            [' ', 'draai %m.servos tot %n graden', 'rotateServo', 'servo A', 180],
            [' ', 'draai %m.servos met %n graden', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', 'wanneer %m.buttons is %m.btnStates', 'whenButton', 'knop A', 'in gedrukt'],
            ['b', '%m.buttons ingedrukt?', 'isButtonPressed', 'knop A'],
            ['-'],
            ['h', 'wanneer%m.hwIn %m.ops %n%', 'whenInput', 'draaiknop', '>', 50],
            ['r', 'read %m.hwIn', 'readInput', 'draaiknop'],
            ['-'],
            [' ', 'schakel pin %n %m.outputs', 'digitalWrite', 1, 'on'],
            [' ', 'schakel pin %n tot %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'wanneer pin %n is %m.outputs', 'whenDigitalRead', 1, 'on'],
            ['b', 'pin %n aan?', 'digitalRead', 1],
            ['-'],
            ['h', 'wanneer analoge %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'lees analoge %n', 'analogRead', 0],
            ['-'],
            ['r', 'zet %n van %n %n tot %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        pl: [
            ['h', 'kiedy urządzenie jest podłączone', 'whenConnected'],
            [' ', 'podłącz %m.hwOut do pinu %n', 'connectHW', 'led A', 3],
            [' ', 'podłącz %m.hwIn do we analogowego %n', 'connectHW', 'pokrętło', 0],
            ['-'],
            [' ', 'ustaw %m.leds na %m.outputs', 'digitalLED', 'led A', 'włączony'],
            [' ', 'ustaw jasność %m.leds na %n%', 'setLED', 'led A', 100],
            [' ', 'zmień jasność %m.leds o %n%', 'changeLED', 'led A', 20],
            ['-'],
            [' ', 'obróć %m.servos w położenie %n degrees', 'rotateServo', 'serwo A', 180],
            [' ', 'obróć %m.servos o %n degrees', 'changeServo', 'serwo A', 20],
            ['-'],
            ['h', 'kiedy %m.buttons jest %m.btnStates', 'whenButton', 'przycisk A', 'wciśnięty'],
            ['b', 'czy %m.buttons jest wciśnięty?', 'isButtonPressed', 'przycisk A'],
            ['-'],
            ['h', 'kiedy %m.hwIn jest w położeniu %m.ops %n%', 'whenInput', 'pokrętło', '>', 50],
            ['r', 'odczytaj ustawienie %m.hwIn', 'readInput', 'pokrętła'],
            ['-'],
            [' ', 'ustaw pin %n jako %m.outputs', 'digitalWrite', 1, 'włączony'],
            [' ', 'ustaw pin %n na %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'kiedy pin %n jest %m.outputs', 'whenDigitalRead', 1, 'włączony'],
            ['b', 'czy pin %n jest włączony?', 'digitalRead', 1],
            ['-'],
            ['h', 'kiedy we analogowe %n jest w położeniu %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'odczytaj we analogowe %n', 'analogRead', 0],
            ['-'],
            ['r', 'przekształć wartość %n z zakresu %n %n na %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        pt: [
            ['h', 'Quando dispositivo estiver conectado', 'whenConnected'],
            [' ', 'conectar%m.hwOut para pino %n', 'connectHW', 'led A', 3],
            [' ', 'conectar %m.hwIn para analogico %n', 'connectHW', 'potenciometro', 0],
            ['-'],
            [' ', 'estado %m.leds %m.outputs', 'digitalLED', 'led A', 'ligado'],
            [' ', 'estado %m.leds brilho to %n%', 'setLED', 'led A', 100],
            [' ', 'mudar %m.leds brilho em %n%', 'changeLED', 'led A', 20],
            ['-'],
            [' ', 'girar %m.servos para %n graus', 'rotateServo', 'servo A', 180],
            [' ', 'girar %m.servos em %n graus', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', 'quando %m.buttons is %m.btnStates', 'whenButton', 'botao A', 'pressionado'],
            ['b', '%m.buttons pressionado?', 'isButtonPressed', 'botao A'],
            ['-'],
            ['h', 'quando %m.hwIn %m.ops %n%', 'whenInput', 'potenciometro', '>', 50],
            ['r', 'read %m.hwIn', 'readInput', 'potenciometro'],
            ['-'],
            [' ', 'estado digital pino %n %m.outputs', 'digitalWrite', 1, 'ligado'],
            [' ', 'estado analogico pino %n to %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'quando pino %n is %m.outputs', 'whenDigitalRead', 1, 'ligado'],
            ['b', 'pino %n ligado?', 'digitalRead', 1],
            ['-'],
            ['h', 'quando valor analogico %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'ler valor analogico %n', 'analogRead', 0],
            ['-'],
            ['r', 'mapear %n from %n %n to %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        ru: [
            ['h', 'когда устройство подключено', 'whenConnected'],
            [' ', 'подключить %m.hwOut к выводу %n', 'connectHW', 'светодиод A', 3],
            [' ', 'подключить %m.hwIn к ан. входу %n', 'connectHW', 'потенциометр', 0],
            ['-'],
            [' ', 'установить %m.leds в %m.outputs', 'digitalLED', 'светодиод A', 'включен'],
            [' ', 'установить яркость %m.leds в %n%', 'setLED', 'светодиод A', 100],
            [' ', 'изменить яркость %m.leds на %n%', 'changeLED', 'светодиод A', 20],
            ['-'],
            [' ', 'установить %m.servos в позицию %n °', 'rotateServo', 'серво A', 180],
            [' ', 'повернуть %m.servos на %n °', 'changeServo', 'серво A', 20],
            ['-'],
            ['h', 'когда %m.buttons %m.btnStates', 'whenButton', 'кнопка A', 'нажата'],
            ['b', '%m.buttons нажата?', 'isButtonPressed', 'кнопка A'],
            ['-'],
            ['h', 'когда %m.hwIn %m.ops %n%', 'whenInput', 'потенциометр', '>', 50],
            ['r', 'значение %m.hwIn', 'readInput', 'потенциометр'],
            ['-'],
            [' ', 'установить выход %n в %m.outputs', 'digitalWrite', 1, 'включен'],
            [' ', 'установить ан. выход %n в %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'когда вход %n %m.outputs', 'whenDigitalRead', 1, 'включен'],
            ['b', 'вход %n вкл?', 'digitalRead', 1],
            ['-'],
            ['h', 'когда ан. вход %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'значение ан. входа %n', 'analogRead', 0],
            ['-'],
            ['r', 'отобразить %n из %n %n в %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        el: [
            ['h', 'Όταν η συσκευή είναι συνδεδεμένη', 'whenConnected'],
            [' ', 'σύνδεσε το %m.hwOut στο pin %n', 'connectHW', 'led A', 3],
            [' ', 'σύνδεσε το %m.hwIn στο αναλογικό %n', 'connectHW', 'ποντεσιόμετρο', 0],
            ['-'],
            [' ', 'άλλαξε το %m.leds σε %m.outputs', 'digitalLED', 'led A', 'ενεργοποιημένο'],
            [' ', 'όρισε στο %m.leds τη φωτεινότητα ίση με %n%', 'setLED', 'led A', 100],
            [' ', 'άλλαξε στο %m.leds τη φωτεινότητα κατά %n%', 'changeLED', 'led A', 20],
            ['-'],
            [' ', 'στρίψε το %m.servos στις %n μοίρες', 'rotateServo', 'servo A', 180],
            [' ', 'στρίψε το %m.servos κατά %n μοίρες', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', 'Όταν το %m.buttons είναι %m.btnStates', 'whenButton', 'κουμπί A', 'πατημένο'],
            ['b', 'το %m.buttons πατήθηκε;', 'isButtonPressed', 'κουμπί A'],
            ['-'],
            ['h', 'Όταν το %m.hwIn %m.ops %n%', 'whenInput', 'ποντεσιόμετρο', '>', 50],
            ['r', 'διάβασε %m.hwIn', 'readInput', 'ποντεσιόμετρο'],
            ['-'],
            [' ', 'άλλαξε το pin %n σε %m.outputs', 'digitalWrite', 1, 'ενεργοποιημένο'],
            [' ', 'όρισε το pin %n σε %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'Όταν το pin %n είναι %m.outputs', 'whenDigitalRead', 1, 'ενεργοποιημένο'],
            ['b', 'το pin %n είναι ενεργοποιημένο;', 'digitalRead', 1],
            ['-'],
            ['h', 'Όταν το αναλογικό %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'διάβασε το αναλογικό %n', 'analogRead', 0],
            ['-'],
            ['r', 'συσχέτισε %n από %n %n έως %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        es: [
            ['h', 'al conectar el dispositivo', 'whenConnected'],
            [' ', 'conectar %m.hwOut al pin %n', 'connectHW', 'led A', 3],
            [' ', 'conectar %m.hwIn al pin analógico %n', 'connectHW', 'potenciómetro', 0],
            ['-'],
            [' ', 'fijar estado de %m.leds a %m.outputs', 'digitalLED', 'led A', 'on'],
            [' ', 'fijar brillo de %m.leds a %n%', 'setLED', 'led A', 100],
            [' ', 'cambiar brillo de %m.leds por %n%', 'changeLED', 'led A', 20],
            ['-'],
            [' ', 'apuntar %m.servos en dirección %n grados', 'rotateServo', 'servo A', 180],
            [' ', 'girar %m.servos %n grados', 'changeServo', 'servo A', 20],
            ['-'],
            ['h', 'cuando el %m.buttons esté %m.btnStates', 'whenButton', 'botón A', 'presionado'],
            ['b', '¿%m.buttons presionado?', 'isButtonPressed', 'botón A'],
            ['-'],
            ['h', 'cuando %m.hwIn %m.ops %n%', 'whenInput', 'potenciómetro', '>', 50],
            ['r', 'leer %m.hwIn', 'readInput', 'potenciómetro'],
            ['-'],
            [' ', 'fijar estado de pin %n a %m.outputs', 'digitalWrite', 1, 'on'],
            [' ', 'fijar pin analógico %n al %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', 'cuando el pin %n esté %m.outputs', 'whenDigitalRead', 1, 'on'],
            ['b', '¿pin %n on?', 'digitalRead', 1],
            ['-'],
            ['h', 'cuando pin analógico %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', 'leer analógico %n', 'analogRead', 0],
            ['-'],
            ['r', 'convertir %n de %n %n a %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ],
        zh: [
            ['h', '當裝置連接時', 'whenConnected'],
            [' ', '連接 %m.hwOut 到腳位 %n', 'connectHW', '發光二極體 A', 3],
            [' ', '連接 %m.hwIn 到類比 %n', 'connectHW', '旋鈕', 0],
            ['-'],
            [' ', '設定 %m.leds %m.outputs', 'digitalLED', '發光二極體 A', 'on'],
            [' ', '設定 %m.leds 亮度為 %n%', 'setLED', '發光二極體 A', 100],
            [' ', '改變 %m.leds 亮度 %n%', 'changeLED', '發光二極體 A', 20],
            ['-'],
            [' ', '旋轉 %m.servos 到 %n 度', 'rotateServo', '伺服馬達 A', 180],
            [' ', '旋轉 %m.servos %n 度', 'changeServo', '伺服馬達 A', 20],
            ['-'],
            ['h', '當 %m.buttons 為 %m.btnStates', 'whenButton', '按鈕 A', '按下'],
            ['b', '%m.buttons 按下?', 'isButtonPressed', '按鈕 A'],
            ['-'],
            ['h', '當 %m.hwIn %m.ops %n%', 'whenInput', '旋鈕', '>', 50],
            ['r', '讀取 %m.hwIn', 'readInput', '旋鈕'],
            ['-'],
            [' ', '設定腳位 %n %m.outputs', 'digitalWrite', 1, '開'],
            [' ', '設定腳位 %n 為 %n%', 'analogWrite', 3, 100],
            ['-'],
            ['h', '當腳位 %n 為 %m.outputs', 'whenDigitalRead', 1, '開'],
            ['b', '腳位 %n 開?', 'digitalRead', 1],
            ['-'],
            ['h', '當類比 %n %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
            ['r', '讀取類比 %n', 'analogRead', 0],
            ['-'],
            ['r', '對應 %n 由 %n %n 為 %n %n', 'mapValues', 50, 0, 100, -240, 240]
        ]
    };

    var menus = {
        en: {
            buttons: ['button A', 'button B', 'button C', 'button D'],
            btnStates: ['pressed', 'released'],
            hwIn: ['rotation knob', 'light sensor', 'temperature sensor'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'button A', 'button B', 'button C', 'button D', 'servo A', 'servo B', 'servo C', 'servo D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['on', 'off'],
            ops: ['>', '=', '<'],
            servos: ['servo A', 'servo B', 'servo C', 'servo D']
        },
        de: {
            buttons: ['Taste A', 'Taste B', 'Taste C', 'Taste D'],
            btnStates: ['gedrückt', 'losgelassen'],
            hwIn: ['Drehknopf', 'Lichtsensor', 'Temperatursensor'],
            hwOut: ['LED A', 'LED B', 'LED C', 'LED D', 'Taste A', 'Taste B', 'Taste C', 'Taste D', 'Servo A', 'Servo B', 'Servo C', 'Servo D'],
            leds: ['LED A', 'LED B', 'LED C', 'LED D'],
            outputs: ['Ein', 'Aus'],
            ops: ['>', '=', '<'],
            servos: ['Servo A', 'Servo B', 'Servo C', 'Servo D']
        },
        fr: {
            buttons: ['Bouton A', 'Bouton B', 'Bouton C', 'Bouton D'],
            btnStates: ['Appuyé', 'Relâché'],
            hwIn: ['Potentiomètre', 'Capteur de Lumière', 'Capteur de Temperature'],
            hwOut: ['LED A', 'LED B', 'LED C', 'LED D', 'Bouton A', 'Bouton B', 'Bouton C', 'Bouton D', 'Servo Moteur A', 'Servo Moteur B', 'Servo Moteur C', 'Servo Moteur D'],
            leds: ['LED A', 'LED B', 'LED C', 'LED D'],
            outputs: ['ON', 'OFF'],
            ops: ['>', '=', '<'],
            servos: ['Servo Moteur A', 'Servo Moteur B', 'Servo Moteur C', 'Servo Moteur D']
        },
        it: {
            buttons: ['pulsante A', 'pulsante B', 'pulsante C', 'pulsante D'],
            btnStates: ['premuto', 'rilasciato'],
            hwIn: ['potenziometro', 'sensore di luce', 'sensore di temperatura'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'pulsante A', 'pulsante B', 'pulsante C', 'pulsante D', 'servo A', 'servo B', 'servo C', 'servo D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['acceso', 'spento'],
            ops: ['>', '=', '<'],
            servos: ['servo A', 'servo B', 'servo C', 'servo D']
        },
        ja: {
            buttons: ['ボタン A', 'ボタン B', 'ボタン C', 'ボタン D'],
            btnStates: ['押された', '放された'],
            hwIn: ['回転つまみ', '光センサー', '温度センサー'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'ボタン A', 'ボタン B', 'ボタン C', 'ボタン D', 'サーボ A', 'サーボ B', 'サーボ C', 'サーボ D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['オン', 'オフ'],
            ops: ['>', '=', '<'],
            servos: ['サーボ A', 'サーボ B', 'サーボ C', 'サーボ D']
        },
        ko: {
            buttons: ['버튼 A', '버튼 B', '버튼 C', '버튼 D'],
            btnStates: ['눌림', '떼짐'],
            hwIn: ['회전 손잡이', '조도 센서', '온도 센서'],
            hwOut: ['led A', 'led B', 'led C', 'led D', '버튼 A', '버튼 B', '버튼 C', '버튼 D', '서보모터 A', '서보모터 B', '서보모터 C', '서보모터 D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['켜기', '끄기'],
            ops: ['>', '=', '<'],
            servos: ['서보모터 A', '서보모터 B', '서보모터 C', '서보모터 D']
        },
        nb: {
            buttons: ['knapp A', 'knapp B', 'knapp C', 'knapp D'],
            btnStates: ['trykkes', 'slippes'],
            hwIn: ['dreieknapp', 'lyssensor', 'temperatursensor'],
            hwOut: ['LED A', 'LED B', 'LED C', 'LED D', 'knapp A', 'knapp B', 'knapp C', 'knapp D', 'servo A', 'servo B', 'servo C', 'servo D'],
            leds: ['LED A', 'LED B', 'LED C', 'LED D'],
            outputs: ['på', 'av'],
            ops: ['>', '=', '<'],
            servos: ['servo A', 'servo B', 'servo C', 'servo D']
        },
        nl: {
            buttons: ['knop A', 'knop B', 'knop C', 'knop D'],
            btnStates: ['ingedrukt', 'losgelaten'],
            hwIn: ['draaiknop', 'licht sensor', 'temperatuur sensor'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'knop A', 'knop B', 'knop C', 'knop D', 'servo A', 'servo B', 'servo C', 'servo D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['aan', 'uit'],
            ops: ['>', '=', '<'],
            servos: ['servo A', 'servo B', 'servo C', 'servo D']
        },
        pl: {
            buttons: ['przycisk A', 'przycisk B', 'przycisk C', 'przycisk D'],
            btnStates: ['wciśnięty', 'zwolniony'],
            hwIn: ['pokrętło', 'czujnik światła', 'czujnik temperatury'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'przycisk A', 'przycisk B', 'przycisk C', 'przycisk D', 'serwo A', 'serwo B', 'serwo C', 'serwo D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['włączony', 'wyłączony'],
            ops: ['>', '=', '<'],
            servos: ['serwo A', 'serwo B', 'serwo C', 'serwo D']
        },
        pt: {
            buttons: ['botao A', 'botao B', 'botao C', 'botao D'],
            btnStates: ['pressionado', 'solto'],
            hwIn: ['potenciometro', 'sensor de luz', 'sensor de temperatura'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'botao A', 'botao B', 'botao C', 'botao D', 'servo A', 'servo B', 'servo C', 'servo D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['ligado', 'desligado'],
            ops: ['>', '=', '<'],
            servos: ['servo A', 'servo B', 'servo C', 'servo D']
        },
        ru: {
            buttons: ['кнопка A', 'кнопка B', 'кнопка C', 'кнопка D'],
            btnStates: ['нажата', 'отпущена'],
            hwIn: ['потенциометр', 'датчик света', 'датчик температуры'],
            hwOut: ['светодиод A', 'светодиод B', 'светодиод C', 'светодиод D', 'кнопка A', 'кнопка B', 'кнопка C', 'кнопка D', 'серво A', 'серво B', 'серво C', 'серво D'],
            leds: ['светодиод A', 'светодиод B', 'светодиод C', 'светодиод D'],
            outputs: ['включен', 'выключен'],
            ops: ['>', '=', '<'],
            servos: ['серво A', 'серво B', 'серво C', 'серво D']
        },
        el: {
            buttons: ['κουμπί A', 'κουμπί B', 'κουμπί C', 'κουμπί D'],
            btnStates: ['πατημένο', 'ελεύθερο'],
            hwIn: ['ποντεσιόμετρο', 'φωτοαισθητήρα', 'θερμοαισθητήρα'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'κουμπί A', 'κουμπί B', 'κουμπί C', 'κουμπί D', 'servo A', 'servo B', 'servo C', 'servo D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['ενεργοποιημένο', 'απενεργοποιημένο'],
            ops: ['>', '=', '<'],
            servos: ['servo A', 'servo B', 'servo C', 'servo D']
        },
        es: {
            buttons: ['botón A', 'botón B', 'botón C', 'botón D'],
            btnStates: ['pulsado', 'liberado'],
            hwIn: ['potenciómetro', 'sensor de luz', 'sensor de temperatura'],
            hwOut: ['led A', 'led B', 'led C', 'led D', 'botón A', 'botón B', 'botón C', 'botón D', 'servo A', 'servo B', 'servo C', 'servo D'],
            leds: ['led A', 'led B', 'led C', 'led D'],
            outputs: ['on', 'off'],
            ops: ['>', '=', '<'],
            servos: ['servo A', 'servo B', 'servo C', 'servo D']
        },
        zh: {
            buttons: ['按鈕 A', '按鈕 B', '按鈕 C', '按鈕 D'],
            btnStates: ['按下', '放開'],
            hwIn: ['旋鈕', '光感應器', '溫度感應器'],
            hwOut: ['發光二極體 A', '發光二極體 B', '發光二極體 C', '發光二極體 D', '按鈕 A', '按鈕 B', '按鈕 C', '按鈕 D', '伺服馬達 A', '伺服馬達 B', '伺服馬達 C', '伺服馬達 D'],
            leds: ['發光二極體 A', '發光二極體 B', '發光二極體 C', '發光二極體 D'],
            outputs: ['開', '關'],
            ops: ['>', '=', '<'],
            servos: ['伺服馬達 A', '伺服馬達 B', '伺服馬達 C', '伺服馬達 D']
        }
    };

    // extension에 대한 설명 정보를 담은 객체
    var descriptor = {
        blocks: blocks[lang],
        menus: menus[lang],
        url: 'http://khanning.github.io/scratch-arduino-extension'
    };

    // Scratch Extention으로 등록
    ScratchExtensions.register('Arduino', descriptor, ext, {type:'serial'});

})({});