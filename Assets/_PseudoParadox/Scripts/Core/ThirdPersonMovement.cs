using UnityEngine;

namespace _PseudoParadox.Scripts.Core
{
    public class ThirdPersonMovement : MonoBehaviour
    {

        public CharacterController controller;
        public Transform cam;
        public Animator animator;
        public Clock clock;
        public PlayerPositionManager playerPositionManager;
        public Transform groundChecker;
        public LayerMask ground;

        public float speed = 6f;
        public float jumpHeight = 6f;

        public float turnSmoothTime = 0.1f;
        float turnSmoothVelocity;
        private Vector3 _velocity;
        private bool _isGrounded;
        private readonly int Forward = Animator.StringToHash("Forward");

        void Update()
        {
            playerPositionManager.StorePosition(transform.position, clock.clockText.text);
            GroundCheck();
            Jump();
            MoveCharacter();
        }

        private void GroundCheck()
        {
            _isGrounded = Physics.CheckSphere(groundChecker.position, .1f, ground, QueryTriggerInteraction.Ignore);
            if (_isGrounded && _velocity.y < 0)
            {
                _velocity.y = 0f;
            }
        }

        private void Jump()
        {
            if (Input.GetButtonDown("Jump") && _isGrounded) {
                _velocity.y += Mathf.Sqrt(jumpHeight * -2f * Physics.gravity.y);
            }
        }

        private void MoveCharacter()
        {
            if (!playerPositionManager.shouldResetPosition)
            {
                var horizontal = Input.GetAxisRaw("Horizontal");
                var vertical = Input.GetAxisRaw("Vertical");
                var direction = new Vector3(horizontal, 0f, vertical).normalized;

                if (direction.magnitude >= 0.1f)
                {
                    var targetAngle = Mathf.Atan2(direction.x, direction.z) * Mathf.Rad2Deg + cam.eulerAngles.y;
                    var angle = Mathf.SmoothDampAngle(transform.eulerAngles.y, targetAngle, ref turnSmoothVelocity, turnSmoothTime);
                    transform.rotation = Quaternion.Euler(0f, angle, 0f);

                    var moveDir = Quaternion.Euler(0f, targetAngle, 0f) * Vector3.forward;
                    controller.Move(moveDir * Time.deltaTime * speed);
                    animator.SetFloat(Forward, (moveDir.magnitude));
                }
                else
                {
                    animator.SetFloat(Forward, 0.0f);
                }


                _velocity.y += Physics.gravity.y * Time.deltaTime;
                controller.Move(_velocity * Time.deltaTime);
            }
            else
            {
                animator.SetFloat(Forward, 0.0f);
                _velocity = Vector3.zero;

                transform.position = playerPositionManager.startingPosition;
                playerPositionManager.shouldResetPosition = false;
            }
        }
    }
}
